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
