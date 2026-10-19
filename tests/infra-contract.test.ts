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

test('admin model authorization requires no independent deployment switch', () => {
  for (const name of ['AllowPaidModels', 'EnableMediaModels', 'BedrockModelAllowlist', 'BedrockResourceArns']) assert.ok(!template.Parameters[name]);
  for (const name of ['ALLOW_PAID_MODELS', 'REKOGNITION_ENABLED', 'BEDROCK_MODEL_ALLOWLIST']) assert.ok(!(name in r.ApiFunction.Properties.Environment.Variables));
  const defaults = JSON.parse(readFileSync(new URL('../config/agent-framework.json', import.meta.url), 'utf8'));
  assert.equal(defaults.allowPaidExecution, false);
});

test('configured Bedrock models have invocation capability without infrastructure or subscription authority', () => {
  const policy = r.ApiRole.Properties.Policies.find((item: any) => item.PolicyName === 'AdminConfiguredBedrockModels');
  assert.ok(policy && !policy.Condition && !policy['Fn::If']);
  const statement = policy.PolicyDocument.Statement[0];
  assert.deepEqual(statement.Action, ['bedrock:InvokeModel']);
  const resources: string[] = statement.Resource.map((item: any) => item['Fn::Sub']);
  assert.ok(resources.every(resource => /^arn:\$\{AWS::Partition\}:bedrock:(\$\{AWS::Region\}|us-east-2|us-west-2):/.test(resource)));
  assert.ok(resources.every(resource => /::foundation-model\/\*$|:\$\{AWS::AccountId\}:(application-)?inference-profile\/\*$/.test(resource)));
  assert.ok(!JSON.stringify(policy).match(/PassRole|marketplace|Create|Delete|Update|FullAccess|InvokeTool|ApplyGuardrail/));
});

test('admin-configured media workflows have only regional label detection capability', () => {
  const policy = r.ApiRole.Properties.Policies.find((item: any) => item.PolicyName === 'AdminConfiguredMediaLabels');
  const statement = policy.PolicyDocument.Statement[0];
  assert.deepEqual(statement.Action, ['rekognition:DetectLabels', 'rekognition:StartLabelDetection', 'rekognition:GetLabelDetection']);
  assert.equal(statement.Resource, '*'); // Label detection does not support resource-level IAM ARNs.
  assert.deepEqual(statement.Condition, { StringEquals: { 'aws:RequestedRegion': { Ref: 'AWS::Region' } } });
  assert.ok(!JSON.stringify(policy).match(/PassRole|Training|Face|Project|Collection/));
});
