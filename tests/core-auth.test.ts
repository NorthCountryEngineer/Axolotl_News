import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

function harness() {
  const store = new Map<string, string>(), calls: { url: string; options: any }[] = [], redirects: string[] = [];
  const config = { issuer: 'https://core.example.com', browser_client_id: 'public-client', redirect_uri: 'https://axolotl.news/oauth/callback', api_url: 'https://api.example.com', organization_id: 'org', service_id: 'service' };
  const location = { search: '', assign: (url: string) => redirects.push(url) };
  let response = async (url: string, options: any) => ({ ok: true, json: async () => url.endsWith('/oauth/token/') ? { access_token: 'opaque-access', token_type: 'Bearer', expires_in: 300, refresh_token: 'rotated-refresh', id_token: 'discard-this-id-token' } : { permissions: ['posts-write'] } });
  const source = readFileSync(new URL('../src/lib/core.ts', import.meta.url), 'utf8').replace("import.meta.env.VITE_APP_MODE", "'nce'").replace("import.meta.glob('../../nce-config.json', { eager: true, import: 'default' })", JSON.stringify({ file: config }));
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  const context = vm.createContext({ exports, require: () => ({}), crypto: webcrypto, AbortSignal, TextEncoder, Uint8Array, URL, URLSearchParams, btoa, Date, JSON, location, history: { replaceState: (_a: any, _b: any, path: string) => redirects.push(path) }, sessionStorage: { getItem: (k: string) => store.get(k) || null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) }, fetch: async (url: string, options: any) => { calls.push({ url, options }); return response(url, options); } });
  vm.runInContext(js, context);
  return { api: exports, store, calls, redirects, location, config, respond: (r: typeof response) => { response = r; } };
}

test('Core login generates PKCE S256 and unpredictable state without a browser secret', async () => {
  const h = harness(); await h.api.beginCoreLogin();
  const url = new URL(h.redirects[0]), flow = JSON.parse(h.store.get('axolotl-core-flow')!);
  assert.equal(url.origin, h.config.issuer); assert.equal(url.searchParams.get('client_id'), 'public-client'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('state'), flow.state); assert.ok(flow.state.length >= 40);
  const digest = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(flow.verifier))).toString('base64url');
  assert.equal(url.searchParams.get('code_challenge'), digest); assert.equal(url.searchParams.get('scope'), 'openid authorization'); assert.ok(!url.searchParams.has('client_secret')); assert.equal(h.calls.length, 0);
});

test('callback validates state, exchanges code once, and discards ID token authority', async () => {
  const h = harness(); await h.api.beginCoreLogin(); const flow = JSON.parse(h.store.get('axolotl-core-flow')!);
  h.location.search = `?code=one-use-code&state=${flow.state}&iss=${encodeURIComponent(h.config.issuer)}`;
  await Promise.all([h.api.completeCoreLogin(), h.api.completeCoreLogin()]);
  assert.equal(h.calls.length, 1); const body = h.calls[0].options.body;
  assert.equal(body.get('code_verifier'), flow.verifier); assert.equal(body.get('redirect_uri'), h.config.redirect_uri); assert.equal(h.calls[0].options.credentials, 'omit');
  const tokens = JSON.parse(h.store.get('axolotl-core-tokens')!); assert.equal(tokens.access_token, 'opaque-access'); assert.ok(!tokens.id_token); assert.ok(!h.store.has('axolotl-core-flow')); assert.equal(h.redirects.at(-1), '/studio');
});

test('invalid state, expired flow, and unexpected issuer fail before token exchange', async () => {
  for (const bad of ['state', 'expired', 'issuer']) {
    const h = harness(); await h.api.beginCoreLogin(); const flow = JSON.parse(h.store.get('axolotl-core-flow')!);
    if (bad === 'expired') { flow.at = Date.now() - 700000; h.store.set('axolotl-core-flow', JSON.stringify(flow)); }
    h.location.search = `?code=code&state=${bad === 'state' ? 'wrong' : flow.state}&iss=${encodeURIComponent(bad === 'issuer' ? 'https://evil.example' : h.config.issuer)}`;
    await assert.rejects(h.api.completeCoreLogin()); assert.equal(h.calls.length, 0); assert.ok(!h.store.has('axolotl-core-tokens'));
  }
});

test('concurrent expired requests rotate refresh token once and send only access bearer', async () => {
  const h = harness(); h.store.set('axolotl-core-tokens', JSON.stringify({ access_token: 'expired', refresh_token: 'old-refresh', expires_at: 0 }));
  await Promise.all([h.api.coreSession(), h.api.coreSession()]);
  assert.equal(h.calls.filter(c => c.url.endsWith('/oauth/token/')).length, 1);
  const resources = h.calls.filter(c => c.url.endsWith('/session'));
  assert.equal(resources.length, 2); for (const r of resources) assert.equal(r.options.headers.Authorization, 'Bearer opaque-access');
  assert.equal(JSON.parse(h.store.get('axolotl-core-tokens')!).refresh_token, 'rotated-refresh');
});

test('logout cancels pending refresh persistence and revokes the newly returned token', async () => {
  const h = harness(); h.store.set('axolotl-core-tokens', JSON.stringify({ access_token: 'expired', refresh_token: 'old-refresh', expires_at: 0 }));
  let finish: () => void = () => {}; const wait = new Promise<void>(resolve => { finish = resolve; });
  h.respond(async (url: string) => { if (url.endsWith('/oauth/token/')) await wait; return { ok: true, json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 300 }) }; });
  const session = h.api.coreSession(); await new Promise(resolve => setTimeout(resolve, 0));
  await h.api.coreLogout(); finish(); assert.equal(await session, false); assert.ok(!h.store.has('axolotl-core-tokens'));
  const revoked = h.calls.filter(c => c.url.endsWith('/oauth/revoke/')).map(c => c.options.body.get('token'));
  assert.deepEqual(revoked, ['old-refresh', 'new-refresh']); assert.ok(!h.calls.some(c => c.url.endsWith('/session')));
});
