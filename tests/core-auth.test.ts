import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

function harness(initialStore?: Map<string, string>) {
  const store = initialStore || new Map<string, string>(), calls: { url: string; options: any }[] = [], redirects: string[] = [];
  const config = { issuer: 'https://core.example.com', browser_client_id: 'public-client', redirect_uri: 'https://axolotl.news/oauth/callback', api_url: 'https://api.example.com', organization_id: 'org', service_id: 'service' };
  const location = { search: '', assign: (url: string) => redirects.push(url) };
  let response = async (url: string, options: any) => ({ ok: true, json: async () => url.endsWith('/oauth/token/') ? { access_token: 'opaque-access', token_type: 'Bearer', expires_in: 300, refresh_token: 'rotated-refresh', id_token: 'discard-this-id-token' } : { permissions: ['posts-write'] } });
  const source = readFileSync(new URL('../src/lib/core.ts', import.meta.url), 'utf8').replace("import.meta.env.VITE_APP_MODE", "'nce'").replace("import.meta.glob('../../nce-config.json', { eager: true, import: 'default' })", JSON.stringify({ file: config }));
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  const context = vm.createContext({ exports, require: () => ({}), crypto: webcrypto, AbortSignal, TextEncoder, Uint8Array, URL, URLSearchParams, btoa, Date, JSON, Error, location, history: { replaceState: (_a: any, _b: any, path: string) => redirects.push(path) }, sessionStorage: { get length() { return store.size; }, key: (index: number) => [...store.keys()][index] || null, getItem: (k: string) => store.get(k) || null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) }, fetch: async (url: string, options: any) => { calls.push({ url, options }); return response(url, options); } });
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

test('invitation account creation preserves the PKCE authorization continuation on Core', async () => {
  const h = harness(); await h.api.beginCoreLogin('signup');
  const signup = new URL(h.redirects[0]);
  assert.equal(signup.origin, h.config.issuer);
  assert.equal(signup.pathname, '/accounts/app-signup/');
  const continuation = new URL(signup.searchParams.get('next')!, h.config.issuer);
  assert.equal(continuation.origin, h.config.issuer);
  assert.equal(continuation.pathname, '/oauth/authorize/');
  assert.equal(continuation.searchParams.get('redirect_uri'), h.config.redirect_uri);
  assert.equal(continuation.searchParams.get('client_id'), h.config.browser_client_id);
  assert.equal(continuation.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(continuation.searchParams.get('state'), JSON.parse(h.store.get('axolotl-core-flow')!).state);
  assert.equal(h.calls.length, 0);
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
  await h.api.coreLogout(); finish(); await assert.rejects(session, /signed out/); assert.ok(!h.store.has('axolotl-core-tokens'));
  const revoked = h.calls.filter(c => c.url.endsWith('/oauth/revoke/')).map(c => c.options.body.get('token'));
  assert.deepEqual(revoked, ['old-refresh', 'new-refresh']); assert.ok(!h.calls.some(c => c.url.endsWith('/session')));
});

test('a failed publishing session is reported instead of silently looking signed out', async () => {
  const h = harness();
  assert.equal(await h.api.coreSession(), false);
  h.store.set('axolotl-core-tokens', JSON.stringify({ access_token: 'access', expires_at: Date.now() + 300000 }));
  h.respond(async () => ({ ok: false, json: async () => ({ error: 'Your Core account does not have this newsroom permission.' }) }));
  await assert.rejects(h.api.coreSession(), /Newsroom access check failed: Your Core account/);
  assert.ok(h.store.has('axolotl-core-tokens'), 'A permission failure must not discard a valid identity token.');
});

test('admin access requires live write and publish permissions, while an editor only needs write', async () => {
  const h = harness();
  assert.equal(await h.api.coreAdminSession(), false);
  h.store.set('axolotl-core-tokens', JSON.stringify({ access_token: 'access', expires_at: Date.now() + 300000 }));
  for (const permissions of [[], ['posts-write'], ['posts-publish'], ['posts-write', 'posts-publish']]) {
    h.respond(async () => ({ ok: true, json: async () => ({ permissions }) }));
    assert.equal(await h.api.coreSession(), permissions.includes('posts-write'));
    assert.equal(await h.api.coreAdminSession(), permissions.includes('posts-write') && permissions.includes('posts-publish'));
  }
  h.respond(async () => ({ ok: false, json: async () => ({ error: 'Permission was revoked.' }) }));
  await assert.rejects(h.api.coreAdminSession(), /admin check failed: Permission was revoked/);
  assert.equal(h.calls.filter(call => call.url.endsWith('/session')).length, 9);
});

test('account administration uses only the explicit current server capability', async () => {
  const h = harness();
  assert.equal(await h.api.coreAccountAdminSession(), false);
  assert.equal(h.calls.length, 0);
  h.store.set('axolotl-core-tokens', JSON.stringify({ access_token: 'access', expires_at: Date.now() + 300000 }));
  for (const canManageAccounts of [undefined, false, 'true', true]) {
    h.respond(async () => ({ ok: true, json: async () => ({ permissions: ['posts-write', 'posts-publish'], canManageAccounts }) }));
    assert.equal(await h.api.coreAccountAdminSession(), canManageAccounts === true);
  }
  h.respond(async () => ({ ok: false, json: async () => ({ error: 'Account access was revoked.' }) }));
  await assert.rejects(h.api.coreAccountAdminSession(), /Account access was revoked/);
});
test('agent administration uses its own live server capability instead of publishing or account access', async () => {
  const h = harness();
  assert.equal(await h.api.coreAgentAdminSession(), false); assert.equal(h.calls.length, 0);
  h.store.set('axolotl-core-tokens', JSON.stringify({ access_token: 'access', expires_at: Date.now() + 300000 }));
  for (const canConfigureAgents of [undefined, false, 'true', true]) {
    h.respond(async () => ({ ok: true, json: async () => ({ permissions: ['posts-write', 'posts-publish', 'accounts-manage'], canManageAccounts: true, canConfigureAgents }) }));
    assert.equal(await h.api.coreAgentAdminSession(), canConfigureAgents === true);
  }
  h.respond(async () => ({ ok: false, json: async () => ({ error: 'Agent administration was revoked.' }) }));
  await assert.rejects(h.api.coreAgentAdminSession(), /Agent administration was revoked/);
});

test('duplicate retries reuse the same target after a lost response and deletion calls the complete-content endpoint', async () => {
  const h = harness();
  h.store.set('axolotl-core-tokens', JSON.stringify({ access_token: 'access', expires_at: Date.now() + 300000 }));
  let lost = true;
  h.respond(async (url: string, options: any) => {
    if (url.endsWith('/duplicate') && lost) { lost = false; throw new TypeError('Lost response'); }
    return { ok: true, json: async () => url.endsWith('/duplicate') ? { id: JSON.parse(options.body).id, status: 'Draft' } : { removed: true } };
  });
  await assert.rejects(h.api.coreDuplicate({ id: 'original' }), /Lost response/);
  const resumed = harness(h.store);
  resumed.respond(async (_url: string, options: any) => ({ ok: true, json: async () => ({ id: JSON.parse(options.body).id, status: 'Draft' }) }));
  const copy = await resumed.api.coreDuplicate({ id: 'original' });
  const requests = [...h.calls, ...resumed.calls].filter(call => call.url.endsWith('/duplicate'));
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(requests[0].options.body).id, copy.id);
  assert.equal(JSON.parse(requests[1].options.body).id, copy.id);
  assert.ok(!h.store.has('axolotl-core-copy:org:original'));
  await h.api.coreDeleteContent({ id: 'original' });
  assert.equal(h.calls.at(-1)!.url, 'https://api.example.com/posts/original/content');
  assert.equal(h.calls.at(-1)!.options.method, 'DELETE');
});

test('deleting an incomplete copy clears its persisted retry target so the original can be duplicated again', async () => {
  const h = harness(); h.store.set('axolotl-core-tokens', JSON.stringify({ access_token: 'access', expires_at: Date.now() + 300000 }));
  h.respond(async () => { throw new TypeError('Lost response'); });
  await assert.rejects(h.api.coreDuplicate({ id: 'original' }), /Retry Duplicate/);
  const abandoned = h.store.get('axolotl-core-copy:org:original')!;
  const resumed = harness(h.store);
  resumed.respond(async (url: string, options: any) => ({ ok: true, json: async () => url.endsWith('/duplicate') ? { id: JSON.parse(options.body).id, status: 'Draft' } : { removed: true } }));
  await resumed.api.coreDeleteContent({ id: abandoned });
  assert.ok(!h.store.has('axolotl-core-copy:org:original'));
  const fresh = await resumed.api.coreDuplicate({ id: 'original' });
  assert.notEqual(fresh.id, abandoned);
});

test('Core callback denial is distinct from a token exchange rejection and never exposes provider descriptions', async () => {
  for (const atCallback of [true, false]) {
    const h = harness(); await h.api.beginCoreLogin();
    const flow = JSON.parse(h.store.get('axolotl-core-flow')!);
    h.location.search = `?state=${flow.state}&${atCallback ? 'error=access_denied&error_description=private-token-value' : 'code=private-code-value'}`;
    h.respond(async () => ({ ok: false, json: async () => ({ error: 'invalid_grant', error_description: 'private-token-value' }) }));
    await assert.rejects(h.api.completeCoreLogin(), (e: Error) => {
      assert.match(e.message, atCallback ? /cancelled or denied/ : /could not exchange/);
      assert.ok(!e.message.includes('private-')); return true;
    });
    assert.equal(h.calls.length, atCallback ? 0 : 1);
    assert.ok(!h.store.has('axolotl-core-tokens'));
  }
});

test('token endpoint network failures and non-JSON responses have actionable messages', async () => {
  for (const kind of ['network', 'html']) {
    const h = harness(); await h.api.beginCoreLogin();
    const flow = JSON.parse(h.store.get('axolotl-core-flow')!);
    h.location.search = `?state=${flow.state}&code=one-use-code`;
    h.respond(async () => {
      if (kind === 'network') throw new TypeError('Failed to fetch');
      return { ok: false, json: async () => { throw new SyntaxError('Unexpected token'); } };
    });
    await assert.rejects(h.api.completeCoreLogin(), kind === 'network' ? /allowed browser origin/ : /proxy deployment/);
    assert.ok(!h.store.has('axolotl-core-tokens'));
  }
});
