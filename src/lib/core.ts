import type { Post } from './model';
import { extensionFor, mediaKeys, publicDocument, validateFile, validatePost } from './model';

export const isCore = import.meta.env.VITE_APP_MODE === 'nce';
const files = import.meta.glob('../../nce-config.json', { eager: true, import: 'default' });
export type CoreConfig = { issuer: string; browser_client_id: string; redirect_uri: string; api_url: string; organization_id: string; service_id: string };
export const coreConfig = Object.values(files)[0] as CoreConfig | undefined;
if (isCore && !coreConfig) throw new Error('Missing nce-config.json. Follow docs/AWS_DEPLOYMENT.md.');
type Tokens = { access_token: string; refresh_token?: string; expires_at: number };
const tokenKey = 'axolotl-core-tokens', flowKey = 'axolotl-core-flow';
let refresh: Promise<Tokens> | undefined;
let callback: Promise<void> | undefined;
let sessionGeneration = 0;
const config = () => { if (!coreConfig) throw new Error('Core is not configured.'); return coreConfig; };
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function readTokens(): Tokens | undefined { try { return JSON.parse(sessionStorage.getItem(tokenKey) || 'null') || undefined; } catch { sessionStorage.removeItem(tokenKey); } }
function authorizationError(code: unknown): string {
  // Display only known error codes, never the provider's arbitrary description
  // or callback URL, which can contain credentials.
  const messages: Record<string, string> = {
    access_denied: 'Core authorization was cancelled or denied.',
    invalid_grant: 'Core could not exchange the sign-in code. Start sign-in again.',
    invalid_client: 'Core does not recognize this newsroom’s browser client. Check its registration.',
    unauthorized_client: 'Core has not enabled this newsroom’s browser client for sign-in.',
    invalid_request: 'Core rejected the sign-in request. Check the browser client and callback configuration.',
    invalid_scope: 'Core rejected the newsroom’s requested sign-in permissions.',
    server_error: 'Core could not complete sign-in. Try again shortly.',
    temporarily_unavailable: 'Core sign-in is temporarily unavailable. Try again shortly.',
  };
  return typeof code === 'string' && Object.hasOwn(messages, code) ? messages[code] : 'Core sign-in failed. Start sign-in again.';
}
async function exchange(fields: Record<string, string>, generation = sessionGeneration): Promise<Tokens> {
  const c = config();
  let r: Response;
  try {
    r = await fetch(`${c.issuer}/oauth/token/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.browser_client_id, ...fields }), credentials: 'omit', redirect: 'error' });
  } catch { throw new Error('The browser could not reach Core’s token endpoint. Check the connection and Core’s allowed browser origin.'); }
  let t;
  try { t = await r.json(); } catch { throw new Error('Core’s token endpoint returned an unexpected response. Check the Core proxy deployment.'); }
  if (!r.ok) throw new Error(authorizationError(t?.error));
  if (!t || typeof t.access_token !== 'string' || t.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(t.expires_in)) throw new Error('Core’s token endpoint returned an invalid session.');
  // ID tokens are never used to authorize API requests. The backend checks the
  // opaque access token with live, service-bound Core introspection every time.
  const tokens = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 };
  if (generation !== sessionGeneration) {
    await revokeToken(tokens.refresh_token || tokens.access_token);
    throw new Error('This session was signed out. Sign in again to continue.');
  }
  sessionStorage.setItem(tokenKey, JSON.stringify(tokens)); return tokens;
}
function loginReturnPath(value: unknown = '/studio'): string {
  if (typeof value === 'string' && (value === '/studio' || value === '/games' || /^\/games\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) return value;
  throw new Error('Choose a newsroom or game page before starting sign-in.');
}
export async function beginCoreLogin(action: 'login' | 'signup' = 'login', returnTo = '/studio') {
  const destination = loginReturnPath(returnTo);
  const c = config(), verifier = b64(crypto.getRandomValues(new Uint8Array(48))), state = b64(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  sessionStorage.setItem(flowKey, JSON.stringify({ verifier, state, at: Date.now(), returnTo: destination }));
  const url = new URL(`${c.issuer}/oauth/authorize/`);
  url.search = new URLSearchParams({ client_id: c.browser_client_id, redirect_uri: c.redirect_uri, response_type: 'code', scope: 'openid authorization', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
  if (action === 'signup') {
    const signup = new URL(`${c.issuer}/accounts/app-signup/`);
    signup.searchParams.set('next', url.pathname + url.search);
    location.assign(signup.href);
  } else location.assign(url.href);
}
export function completeCoreLogin(): Promise<void> {
  if (callback) return callback;
  callback = (async () => {
    const c = config(), params = new URLSearchParams(location.search);
    const stored = sessionStorage.getItem(flowKey); sessionStorage.removeItem(flowKey);
    if (!stored) throw new Error('Sign-in state is missing. Start sign-in again.');
    const flow = JSON.parse(stored);
    if (params.get('state') !== flow.state || Date.now() - flow.at > 600000 || flow.at > Date.now()) throw new Error('Sign-in state is invalid or expired. Start sign-in again.');
    const destination = loginReturnPath(flow.returnTo);
    if (params.has('iss') && params.get('iss') !== c.issuer) throw new Error('Unexpected sign-in issuer.');
    if (params.has('error')) throw new Error(authorizationError(params.get('error')));
    if (!params.get('code')) throw new Error('Core did not return a sign-in code. Start sign-in again.');
    await exchange({ grant_type: 'authorization_code', code: params.get('code')!, redirect_uri: c.redirect_uri, code_verifier: flow.verifier });
    history.replaceState({}, '', destination);
  })(); return callback;
}
async function accessToken(): Promise<string> {
  const t = readTokens(); if (!t) throw new Error('Sign in through Core to continue.');
  if (t.expires_at > Date.now() + 15000) return t.access_token;
  if (!t.refresh_token) { sessionStorage.removeItem(tokenKey); throw new Error('Sign in through Core again.'); }
  if (!refresh) {
    const generation = sessionGeneration;
    refresh = exchange({ grant_type: 'refresh_token', refresh_token: t.refresh_token }, generation).catch(e => { if (generation === sessionGeneration) sessionStorage.removeItem(tokenKey); throw e; }).finally(() => { refresh = undefined; });
  }
  return (await refresh).access_token;
}
export async function coreRequest<T>(path: string, method = 'GET', body?: unknown, protectedRequest = true): Promise<T> {
  const c = config(), headers: Record<string, string> = {};
  if (protectedRequest) headers.Authorization = `Bearer ${await accessToken()}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${c.api_url.replace(/\/$/, '')}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', redirect: 'error' });
  const data = await r.json();
  if (!r.ok) throw Object.assign(new Error(data.error || 'The publishing service could not complete the request.'), { status: r.status });
  return data as T;
}
export async function coreSession(): Promise<boolean> {
  if (!readTokens()) return false;
  try { const session = await coreRequest<{ permissions?: unknown }>('/session'); return Array.isArray(session.permissions) && session.permissions.includes('posts-write'); }
  catch (e) { throw new Error(`Newsroom access check failed: ${e instanceof Error ? e.message : 'The publishing service could not be reached.'}`); }
}
/** Player identity grants score submission, never access to the editing workspace. */
export async function corePlayerSession(): Promise<{ authenticated: boolean; canEdit: boolean }> {
  if (!readTokens()) return { authenticated: false, canEdit: false };
  const session = await coreRequest<unknown>('/game-scores/session');
  if (!session || typeof session !== 'object' || Array.isArray(session) || Object.keys(session).sort().join(',') !== 'authenticated,canEdit' || (session as { authenticated?: unknown }).authenticated !== true || typeof (session as { canEdit?: unknown }).canEdit !== 'boolean') throw new Error('Core returned an invalid player session. Sign in again to continue.');
  return { authenticated: true, canEdit: (session as { canEdit: boolean }).canEdit };
}
export async function coreAdminSession(): Promise<boolean> {
  if (!readTokens()) return false;
  try {
    const session = await coreRequest<{ permissions?: unknown }>('/session');
    const permissions = session.permissions;
    return Array.isArray(permissions) && ['posts-write', 'posts-publish'].every(permission => permissions.includes(permission));
  } catch (e) { throw new Error(`Newsroom admin check failed: ${e instanceof Error ? e.message : 'The publishing service could not be reached.'}`); }
}
export async function coreAccountAdminSession(): Promise<boolean> {
  if (!readTokens()) return false;
  const session = await coreRequest<{ canManageAccounts?: boolean }>('/session');
  return session.canManageAccounts === true;
}
export async function coreAgentAdminSession(): Promise<boolean> {
  if (!readTokens()) return false;
  const session = await coreRequest<{ canConfigureAgents?: boolean }>('/session');
  return session.canConfigureAgents === true;
}
async function revokeToken(token: string) {
  const c = config();
  try { await fetch(`${c.issuer}/oauth/revoke/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.browser_client_id, token }), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) }); } catch { /* Credentials are still cleared locally when Core is unreachable. */ }
}
export async function coreLogout() {
  sessionGeneration++;
  const t = readTokens(); sessionStorage.removeItem(tokenKey); sessionStorage.removeItem(flowKey);
  if (t) await revokeToken(t.refresh_token || t.access_token);
}
export async function coreList(published = false): Promise<Post[]> {
  const all: Post[] = []; let cursor: string | undefined;
  do { const r = await coreRequest<{ posts: Post[]; cursor?: string }>(`${published ? '/published' : '/posts'}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, 'GET', undefined, !published); all.push(...r.posts); cursor = r.cursor; if (all.length >= 1000 && cursor) throw new Error('Archive exceeds 1,000 posts. Add an archive page before continuing.'); } while (cursor);
  return all.sort((a, b) => (b.publishedAt || b.updatedAt || '').localeCompare(a.publishedAt || a.updatedAt || ''));
}
export async function coreSave(post: Post): Promise<Post> { validatePost(post); return coreRequest(`/posts/${post.id}`, 'PUT', post); }
export async function coreUpload(postId: string, file: File, onProgress?: (n: number) => void) {
  const type = validateFile(file), key = `drafts/${postId}/${crypto.randomUUID()}.${extensionFor(file.type)}`;
  const upload = await coreRequest<{ url: string; fields: Record<string, string> }>('/media/upload', 'POST', { key, mime: file.type, size: file.size });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest(), form = new FormData(); Object.entries(upload.fields).forEach(([k, v]) => form.append(k, v)); form.append('file', file);
    xhr.open('POST', upload.url); xhr.upload.onprogress = e => onProgress?.(e.lengthComputable ? Math.round(e.loaded / e.total * 100) : 0);
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed. Check the S3 CORS configuration.'));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection.')); xhr.send(form);
  }); return { key, type };
}
export async function coreAssetURL(key: string): Promise<string> { return (await coreRequest<{ url: string }>(`/media/read?key=${encodeURIComponent(key)}`, 'GET', undefined, !key.startsWith('published/'))).url; }
export async function coreAssetBlob(key: string): Promise<Blob> { const r = await fetch(await coreAssetURL(key)); if (!r.ok) throw new Error('File download failed.'); return r.blob(); }
export async function corePublish(post: Post): Promise<Post> {
  const doc = validatePost(post), draft = await coreSave(post), keys = new Map<string, string>(), revision = crypto.randomUUID();
  for (const key of mediaKeys(doc)) {
    if (!key.startsWith(`drafts/${post.id}/`)) throw new Error('Re-upload media belonging to another draft.');
    const target = `published/${post.id}/${revision}/${key.split('/').pop()}`;
    await coreRequest('/media/copy', 'POST', { source: key, key: target }); keys.set(key, target);
  }
  const published = await coreRequest<Post>(`/published/${post.id}`, 'PUT', { ...draft, document: JSON.stringify(publicDocument(doc, keys)), coverKey: post.coverKey ? keys.get(post.coverKey) : undefined });
  try { await coreSave({ ...draft, status: 'Published', publishedAt: published.publishedAt }); } catch { throw new Error('The post is live, but draft status did not save. Reload before continuing.'); }
  return published;
}
export async function coreUnpublish(post: Post) { const draft = await coreSave(post); await coreRequest(`/published/${post.id}`, 'DELETE'); await coreSave({ ...draft, status: 'Draft', publishedAt: undefined }); }
export async function coreCleanup(postId: string) { await coreRequest(`/media/cleanup/${postId}`, 'DELETE'); }
export async function coreDelete(post: Post) { await coreRequest(`/posts/${post.id}`, 'DELETE'); }
const pendingDuplicates = new Map<string, string>();
export async function coreDuplicate(post: Post): Promise<Post> {
  // A lost response must resume the same copy, never create a second one.
  const storageKey = `axolotl-core-copy:${config().organization_id}:${post.id}`;
  let stored: string | null = null;
  try { stored = sessionStorage.getItem(storageKey); } catch { /* Memory fallback also covers restricted browser storage. */ }
  const id = pendingDuplicates.get(post.id) || (stored && /^[0-9a-f-]{36}$/i.test(stored) ? stored : crypto.randomUUID());
  pendingDuplicates.set(post.id, id);
  try { sessionStorage.setItem(storageKey, id); } catch { /* Keep the in-memory retry identity. */ }
  try {
    const result = await coreRequest<Post>(`/posts/${post.id}/duplicate`, 'POST', { id });
    if (result.id !== id || result.status !== 'Draft') throw new Error('The service did not confirm the new draft.');
    pendingDuplicates.delete(post.id);
    try { sessionStorage.removeItem(storageKey); } catch { /* The confirmed copy is still usable. */ }
    return result;
  } catch (error) { throw new Error(`The copy could not be confirmed. Retry Duplicate to resume the same copy. ${error instanceof Error ? error.message : ''}`.trim()); }
}
export async function coreDeleteContent(post: Post): Promise<void> {
  await coreRequest(`/posts/${post.id}/content`, 'DELETE');
  for (const [source, target] of pendingDuplicates) if (source === post.id || target === post.id) pendingDuplicates.delete(source);
  const prefix = `axolotl-core-copy:${config().organization_id}:`;
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix) && (key === prefix + post.id || sessionStorage.getItem(key) === post.id)) sessionStorage.removeItem(key);
    }
  } catch { /* Deletion succeeded even when browser storage becomes unavailable. */ }
}
