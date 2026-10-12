import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { mock, test } from 'node:test';
import { Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

// Compile definitions locally with invented deployment identifiers. Block
// network requests so this test cannot reach AWS, provision, or incur usage.
mock.method(http, 'request', () => { throw new Error('Network is disabled in backend contract tests.'); });
mock.method(http, 'get', () => { throw new Error('Network is disabled in backend contract tests.'); });
mock.method(https, 'request', () => { throw new Error('Network is disabled in backend contract tests.'); });
mock.method(https, 'get', () => { throw new Error('Network is disabled in backend contract tests.'); });
mock.method(globalThis, 'fetch', () => { throw new Error('Network is disabled in backend contract tests.'); });
process.env.AWS_EC2_METADATA_DISABLED = 'true';
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  'amplify-backend-namespace': 'offline-contract',
  'amplify-backend-name': 'main',
  'amplify-backend-type': 'branch',
});

const { backend } = await import('../amplify/backend');
type Resource = { Type: string; Properties?: Record<string, any>; DeletionPolicy?: string };
function resources(stack: Stack): Resource[] {
  return Object.values(Template.fromStack(stack).toJSON().Resources || {});
}
const authResources = resources(backend.auth.stack);
const storageResources = resources(backend.storage.stack);
const stacks = new Set(backend.stack.node.findAll().map((node) => Stack.of(node)));
const allResources = [...stacks].flatMap(resources);

function rolePolicy(role: string): Resource {
  const policy = storageResources.find((r) => r.Type === 'AWS::IAM::Policy' &&
    JSON.stringify(r.Properties?.Roles).includes(role) &&
    !(role === 'authenticatedUserRole' && JSON.stringify(r.Properties?.Roles).includes('unauthenticatedUserRole')));
  assert.ok(policy, `Missing storage policy for ${role}`);
  return policy;
}
function actions(policy: Resource): string[] {
  return policy.Properties!.PolicyDocument.Statement.flatMap((s: { Action: string | string[] }) => s.Action);
}
function authTemplate(name: string): string {
  const fn = allResources.find((r) => r.Type === 'AWS::AppSync::FunctionConfiguration' && r.Properties?.Name === name);
  assert.ok(fn, `Missing generated auth resolver ${name}`);
  const outputDir = (backend.stack.node.root as { outdir: string }).outdir;
  return ['Request', 'Response'].map((direction) => {
    const inline = fn.Properties![`${direction}MappingTemplate`];
    if (typeof inline === 'string') return inline;
    const location = fn.Properties![`${direction}MappingTemplateS3Location`]['Fn::Sub'] as string;
    const hash = location.match(/\/([a-f0-9]+)\.vtl$/)?.[1];
    assert.ok(hash, 'Expected a locally staged authorization template.');
    const asset = readdirSync(outputDir).find((file) => file.includes(hash));
    assert.ok(asset, 'Authorization asset was not compiled locally.');
    return readFileSync(path.join(outputDir, asset), 'utf8');
  }).join('\n');
}

test('Cognito enforces invitation-only email login and creates the Editors group', () => {
  const pool = authResources.find((r) => r.Type === 'AWS::Cognito::UserPool');
  assert.equal(pool?.Properties?.AdminCreateUserConfig.AllowAdminCreateUserOnly, true);
  assert.deepEqual(pool?.Properties?.UsernameAttributes, ['email']);
  assert.ok(authResources.some((r) => r.Type === 'AWS::Cognito::UserPoolGroup' && r.Properties?.GroupName === 'Editors'));
  assert.ok(authResources.some((r) => r.Type === 'AWS::Cognito::IdentityPool' && r.Properties?.AllowUnauthenticatedIdentities === true));
  assert.ok(!allResources.some((r) => r.Type === 'AWS::AppSync::ApiKey'));
});

test('guest and ordinary authenticated storage policies can only read published media', () => {
  for (const role of ['unauthenticatedUserRole', 'authenticatedUserRole']) {
    const policy = rolePolicy(role);
    assert.deepEqual(actions(policy).sort(), ['s3:GetObject', 's3:ListBucket']);
    const body = JSON.stringify(policy.Properties!.PolicyDocument);
    assert.ok(body.includes('published/*'));
    assert.ok(!body.includes('drafts/'));
    assert.ok(!body.includes('s3:PutObject') && !body.includes('s3:DeleteObject'));
  }
  const editor = rolePolicy('EditorsGroupRole');
  assert.deepEqual(actions(editor).sort(), ['s3:DeleteObject', 's3:GetObject', 's3:ListBucket', 's3:PutObject']);
  assert.ok(JSON.stringify(editor.Properties!.PolicyDocument).includes('drafts/*'));
});

test('guest API IAM policy has no access to private Post records', () => {
  const policy = resources(backend.data.stack).find((r) => r.Type === 'AWS::IAM::ManagedPolicy' &&
    JSON.stringify(r.Properties?.Roles).includes('unauthenticatedUserRole'));
  assert.ok(policy);
  const body = JSON.stringify(policy.Properties!.PolicyDocument);
  assert.ok(body.includes('listPublishedPosts') && body.includes('getPublishedPost'));
  assert.ok(!body.includes('listPosts') && !body.includes('getPost'));
  assert.ok(!body.includes('"typeName":"Post"'));
});

test('generated publication mutation resolvers reject identity-pool users and require Editors JWTs', () => {
  // Amplify's IAM policy permits invoking generated fields; the resolver is
  // also an authorization boundary and must reject Cognito guest credentials.
  for (const verb of ['create', 'update', 'delete']) {
    const template = authTemplate(`Mutation${verb}PublishedPostauth0Function`);
    assert.ok(template.includes('$util.isNull($ctx.identity.cognitoIdentityPoolId)'));
    assert.ok(template.includes('$util.isNull($ctx.identity.cognitoIdentityId)'));
    assert.ok(template.includes('$util.unauthorized()'));
    assert.ok(template.includes('"claim":"cognito:groups","entity":"Editors"'));
    assert.ok(!template.includes('"entity":"Everyone"'));
  }
});

test('the pinned storage backend makes stack deletion destructive for uploaded media', () => {
  const bucket = storageResources.find((r) => r.Type === 'AWS::S3::Bucket');
  assert.equal(bucket?.DeletionPolicy, 'Delete');
  assert.ok(storageResources.some((r) => r.Type === 'Custom::S3AutoDeleteObjects'));
});
