import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorizeStudioLaunch, legacyStudioPath, listStudioGames, parseGameStudioHostConfig, parseStudioGameRoute, studioCreatorURL, studioGamePath, studioPlayerURL } from '../src/lib/game-studio-host.ts';

const id = '11111111-1111-4111-8111-111111111111';
const config = { origin: 'https://studio.example.com', api_url: 'https://games-api.example.com', host_id: 'axolotl-news' as const };
const game = (version = 3) => ({ id, status: 'Published', revision: 8, publishedRevision: 8, spec: { version, genre: version === 3 ? 'crossword' : 'dodge', title: 'A little adventure', description: 'Keep every existing game.' }, messages: ['must not enter host state'] });

test('host configuration is optional, exact, HTTPS and contains public fields only', () => {
  assert.equal(parseGameStudioHostConfig(undefined), undefined);
  assert.deepEqual(parseGameStudioHostConfig(config), config);
  for (const invalid of [null, {}, [], { ...config, access_token: 'secret' }, { ...config, host_id: 'academy' }, ...['http://studio.example.com', 'https://studio.example.com/', 'https://studio.example.com/path', 'https://studio.example.com?next=evil', 'https://u:p@studio.example.com', 'https://studio.example.com#x'].map(origin => ({ ...config, origin }))]) assert.throws(() => parseGameStudioHostConfig(invalid));
});

test('creator and player navigation keeps service namespaces separate and carries no token', () => {
  const creator = new URL(studioCreatorURL(config));
  assert.equal(creator.href, 'https://studio.example.com/game-studio?host=axolotl-news&login=auto');
  assert.deepEqual([...creator.searchParams.keys()], ['host', 'login']);
  assert.equal(studioGamePath(id), `/games/studio/${id}`);
  assert.equal(legacyStudioPath(id), `/game-studio/legacy?game=${id}`);
  assert.equal(parseStudioGameRoute(`/games/studio/${id}`), id);
  const embedded = new URL(studioPlayerURL(config, id, true));
  assert.equal(embedded.origin, config.origin); assert.equal(embedded.pathname, `/embed/games/${id}`);
  assert.equal(embedded.searchParams.get('host'), config.host_id); assert.match(embedded.searchParams.get('channel')!, /^[a-f0-9-]{36}$/);
  for (const path of [`/games/${id}`, `/games/studio/${id}/extra`, '/games/studio/not-an-id', `//games/studio/${id}`, `/games/studio/${id}?token=x`]) assert.equal(parseStudioGameRoute(path), undefined);
  for (const bad of ['../escape', id + '/extra', 'https://evil.example']) { assert.throws(() => studioGamePath(bad)); assert.throws(() => legacyStudioPath(bad)); assert.throws(() => studioPlayerURL(config, bad)); }
});

test('a deferred administrator check cannot navigate after leaving or revoking the creator route', async () => {
  for (const result of [true, false]) {
    let active = true, finish!: (value: boolean) => void;
    const navigation: string[] = [];
    const pending = authorizeStudioLaunch(config, () => new Promise(resolve => { finish = resolve; }), () => active, url => navigation.push(url));
    active = false; finish(result); await pending;
    assert.deepEqual(navigation, []);
  }
  const navigation: string[] = [];
  await assert.rejects(authorizeStudioLaunch(config, async () => false, () => true, url => navigation.push(url)), /administrator access/);
  assert.deepEqual(navigation, []);
  await authorizeStudioLaunch(config, async () => true, () => true, url => navigation.push(url));
  assert.deepEqual(navigation, [studioCreatorURL(config)]);
});

test('standalone catalog supports new versions without importing private fields or legacy validation', async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const request = async (url: string | URL | Request, options: RequestInit) => { calls.push({ url: String(url), options }); return { ok: true, json: async () => calls.length === 1 ? { games: [], cursor: 'continue' } : { games: [game(3)] } } as Response; };
  const games = await listStudioGames(config, request as typeof fetch);
  assert.deepEqual(games, [{ source: 'studio', id, title: 'A little adventure', description: 'Keep every existing game.', genre: 'crossword', publishedRevision: 8 }]);
  assert.equal(calls.length, 2);
  for (const call of calls) { const url = new URL(call.url); assert.equal(url.origin, config.api_url); assert.equal(url.searchParams.get('specVersion'), 'all'); assert.equal(call.options.credentials, 'omit'); assert.equal(call.options.redirect, 'error'); assert.equal(call.options.headers, undefined); }
  assert.equal(new URL(calls[1].url).searchParams.get('cursor'), 'continue');
});

test('standalone failures reject the external catalog without yielding partial or ambiguous game IDs', async () => {
  for (const response of [{ ok: false, json: async () => ({}) }, { ok: true, json: async () => ({ games: [game(), game()] }) }, { ok: true, json: async () => ({ games: [{ ...game(), status: 'Draft' }] }) }, { ok: true, json: async () => ({ games: [{ ...game(), publishedRevision: 9 }] }) }, { ok: true, json: async () => ({ games: [{ ...game(), id: '../legacy' }] }) }, { ok: true, json: async () => ({ games: [game()], cursor: 'repeated' }) }]) {
    await assert.rejects(listStudioGames(config, (async () => response as Response) as typeof fetch));
  }
});

test('production config generator validates and retains the optional connection without credentials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'axolotl-host-config-'));
  const script = fileURLToPath(new URL('../scripts/write-core-config.mjs', import.meta.url));
  const registration = { issuer: 'https://core.example.com', organization_id: 'org', service_id: 'service', browser_client_id: 'public-client', redirect_uri: 'https://axolotl.news/oauth/callback', game_studio: config };
  try {
    const file = join(directory, 'registration.json'); writeFileSync(file, JSON.stringify(registration));
    const run = () => spawnSync(process.execPath, [script, file, 'https://api.example.com'], { cwd: directory, encoding: 'utf8' });
    assert.equal(run().status, 0); assert.deepEqual(JSON.parse(readFileSync(join(directory, 'nce-config.json'), 'utf8')).game_studio, config);
    writeFileSync(file, JSON.stringify({ ...registration, game_studio: { ...config, api_url: 'https://evil.example/path' } })); assert.notEqual(run().status, 0);
    writeFileSync(file, JSON.stringify({ ...registration, game_studio: { ...config, client_secret: 'never public' } })); assert.notEqual(run().status, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
