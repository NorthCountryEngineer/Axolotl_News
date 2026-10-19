import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const template = JSON.parse(readFileSync(new URL('../infra/aws/axolotl.template.json', import.meta.url), 'utf8'));
const r = template.Resources;
test('Core backend retains separate on-demand draft/public tables and private encrypted media', () => {
  for (const name of ['PrivatePosts', 'PublishedPosts']) { assert.equal(r[name].DeletionPolicy, 'Retain'); assert.equal(r[name].Properties.BillingMode, 'PAY_PER_REQUEST'); }
  assert.equal(r.Media.DeletionPolicy, 'Retain'); assert.ok(Object.values(r.Media.Properties.PublicAccessBlockConfiguration).every(Boolean)); assert.ok(r.Media.Properties.BucketEncryption);
  assert.deepEqual(r.Media.Properties.CorsConfiguration.CorsRules[0].AllowedOrigins, [{ Ref: 'ApplicationOrigin' }]);
});
test('Core API has bounded defaults, finite logs, no paid warm concurrency and no VPC/NAT', () => {
  assert.equal(r.ApiFunction.Properties.Timeout, 30); assert.equal(template.Parameters.LambdaReservedConcurrency.Default, 2); assert.ok(!r.ApiFunction.Properties.ProvisionedConcurrencyConfig);
  assert.equal(r.ApiLogGroup.Properties.RetentionInDays, 7); assert.equal(r.ApiStage.Properties.DefaultRouteSettings.ThrottlingRateLimit, 5);
  assert.ok(!Object.values(r).some((v: any) => /NatGateway|Cognito|AppSync|RDS/.test(v.Type))); assert.ok(!r.ApiFunction.Properties.VpcConfig);
});
test('API secret access is constrained to its configured SSM parameter and KMS context', () => {
  const statements = r.ApiRole.Properties.Policies[0].PolicyDocument.Statement;
  const ssm = statements.find((s: any) => s.Action === 'ssm:GetParameter'); assert.match(JSON.stringify(ssm.Resource), /CoreCredentialsParameter/);
  const kms = statements.find((s: any) => s.Action === 'kms:Decrypt'); assert.ok(kms.Condition.StringEquals['kms:ViaService']); assert.match(JSON.stringify(kms.Condition), /PARAMETER_ARN/);
  assert.ok(!JSON.stringify(template).includes('client_secret'));
});

test('assistant state stays private, encrypted and retained independently of published content', () => {
  assert.equal(r.AssistantState.DeletionPolicy, 'Retain');
  assert.equal(r.AssistantState.UpdateReplacePolicy, 'Retain');
  assert.equal(r.AssistantState.Properties.BillingMode, 'PAY_PER_REQUEST');
  assert.equal(r.AssistantState.Properties.SSESpecification.SSEEnabled, true);
  assert.deepEqual(r.AssistantState.Properties.KeySchema, [{ AttributeName: 'id', KeyType: 'HASH' }]);
  assert.deepEqual(r.ApiFunction.Properties.Environment.Variables.ASSISTANT_TABLE, { Ref: 'AssistantState' });
  const policy = r.ApiRole.Properties.Policies.find((item: any) => item.PolicyName === 'AssistantStateOnly');
  assert.deepEqual(policy.PolicyDocument.Statement[0].Resource, { 'Fn::GetAtt': ['AssistantState', 'Arn'] });
  assert.ok(policy.PolicyDocument.Statement[0].Action.every((action: string) => /^dynamodb:(GetItem|PutItem|UpdateItem|DeleteItem)$/.test(action)));
});

function paidPolicies(overrides: Record<string, string> = {}) {
  const parameters = Object.fromEntries(Object.entries(template.Parameters).map(([key, value]: [string, any]) => [key, value.Default]));
  Object.assign(parameters, overrides);
  function check(value: any): any {
    if (!value || typeof value !== 'object') return value;
    if (value.Ref) return parameters[value.Ref];
    if (value.Condition) return check(template.Conditions[value.Condition]);
    if (value['Fn::Equals']) { const [left, right] = value['Fn::Equals'].map(check); return left === right; }
    if (value['Fn::Not']) return !check(value['Fn::Not'][0]);
    if (value['Fn::And']) return value['Fn::And'].every(check);
    throw new Error('Unsupported condition in infrastructure contract');
  }
  return r.ApiRole.Properties.Policies.filter((policy: any) => policy['Fn::If'] && check(template.Conditions[policy['Fn::If'][0]]))
    .map((policy: any) => policy['Fn::If'][1]);
}

test('paid inference permissions require explicit operator gates and exact Bedrock resources', () => {
  assert.equal(template.Parameters.AllowPaidModels.Default, 'false');
  assert.equal(template.Parameters.EnableMediaModels.Default, 'false');
  assert.equal(template.Parameters.BedrockModelAllowlist.Default, '');
  assert.equal(template.Parameters.BedrockResourceArns.Default, '');
  assert.deepEqual(paidPolicies(), []);
  assert.deepEqual(paidPolicies({ AllowPaidModels: 'true' }), []);
  assert.deepEqual(paidPolicies({ AllowPaidModels: 'true', BedrockModelAllowlist: 'approved.model-v1' }), []);
  const resource = 'arn:aws:bedrock:us-east-1::foundation-model/approved.model-v1';
  const enabled = paidPolicies({ AllowPaidModels: 'true', BedrockModelAllowlist: 'approved.model-v1', BedrockResourceArns: resource });
  assert.equal(enabled.length, 1);
  assert.equal(enabled[0].PolicyDocument.Statement[0].Action, 'bedrock:InvokeModel');
  assert.deepEqual(enabled[0].PolicyDocument.Statement[0].Resource, { 'Fn::Split': [',', { Ref: 'BedrockResourceArns' }] });
  for (const parameter of ['BedrockModelAllowlist', 'BedrockResourceArns']) {
    const pattern = new RegExp(template.Parameters[parameter].AllowedPattern);
    assert.equal(pattern.test('*'), false);
    assert.equal(pattern.test(`${resource}*`), false);
    assert.equal(pattern.test('arn:aws:bedrock:*::foundation-model/*'), false);
  }
});

test('media inference grants only regional label detection after both operator opt-ins', () => {
  assert.deepEqual(paidPolicies({ EnableMediaModels: 'true' }), []);
  const enabled = paidPolicies({ AllowPaidModels: 'true', EnableMediaModels: 'true' });
  assert.equal(enabled.length, 1);
  const statement = enabled[0].PolicyDocument.Statement[0];
  assert.deepEqual(statement.Action, ['rekognition:DetectLabels', 'rekognition:StartLabelDetection', 'rekognition:GetLabelDetection']);
  assert.equal(statement.Resource, '*'); // These three operations do not support resource-level IAM ARNs.
  assert.deepEqual(statement.Condition, { StringEquals: { 'aws:RequestedRegion': { Ref: 'AWS::Region' } } });
  assert.ok(!JSON.stringify(enabled).includes('PassRole'));
});
