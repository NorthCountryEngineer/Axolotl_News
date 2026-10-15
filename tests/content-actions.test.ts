import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
import * as model from '../src/lib/model';
import type { Post } from '../src/lib/model';

function harness(mode: 'preview' | 'cloud' | 'nce' = 'preview') {
  const drafts = new Map<string, Post>(), published = new Map<string, Post>(), assets = new Map<string, Blob>();
  const events: string[] = [];
  let allowed = true, failCopy = false, failCleanup = false, uncertainSave = false;
  const state = { failCopy: (value: boolean) => { failCopy = value; }, failCleanup: (value: boolean) => { failCleanup = value; }, uncertainSave: () => { uncertainSave = true; }, allow: (value: boolean) => { allowed = value; } };
  const local = {
    localPosts: {
      list: async (live = false) => [...(live ? published : drafts).values()],
      save: async (post: Post, live = false) => { (live ? published : drafts).set(post.id, post); events.push(`save:${post.id}`); },
      delete: async (id: string, live = false) => { (live ? published : drafts).delete(id); events.push(`delete:${live ? 'live' : 'draft'}:${id}`); },
      deleteContent: async (id: string) => { drafts.delete(id); published.delete(id); events.push(`delete:all:${id}`); },
    },
    putLocalAsset: async (key: string, blob: Blob) => { if (failCopy && events.some(item => item.startsWith('copy:'))) throw new Error('Copy failed.'); assets.set(key, blob); events.push(`copy:${key}`); },
    localAsset: async (key: string) => { const value = assets.get(key); if (!value) throw new Error('Missing file.'); return value; },
    removeLocalAssets: async (prefix: string) => { if (failCleanup) throw new Error('Cleanup failed.'); for (const key of assets.keys()) if (key.startsWith(prefix)) assets.delete(key); events.push(`remove:${prefix}`); },
  };
  function cloudModel(items: Map<string, Post>) {
    return {
      get: async ({ id }: { id: string }) => ({ data: items.get(id) || null }),
      list: async () => ({ data: [...items.values()] }),
      create: async (post: Post) => { items.set(post.id, post); if (uncertainSave) { uncertainSave = false; throw new Error('Lost save response.'); } return { data: post }; },
      update: async (post: Post) => { items.set(post.id, post); return { data: post }; },
      delete: async ({ id }: { id: string }) => { items.delete(id); events.push(`delete:${items === published ? 'live' : 'draft'}:${id}`); return { data: { id } }; },
    };
  }
  const core = { isCore: mode === 'nce', coreAdminSession: async () => allowed, coreSession: async () => allowed,
    coreList: async () => [...drafts.values()], coreDuplicate: async (post: Post) => ({ ...post, id: 'core-copy' }), coreDeleteContent: async (post: Post) => { events.push(`core-delete:${post.id}`); } };
  const modules: Record<string, unknown> = {
    './model': model, './local': local, './core': core,
    'aws-amplify': { Amplify: { configure: () => {} } },
    'aws-amplify/data': { generateClient: () => ({ models: { Post: cloudModel(drafts), PublishedPost: cloudModel(published) } }) },
    'aws-amplify/auth': { getCurrentUser: async () => ({}), fetchAuthSession: async () => ({ tokens: { accessToken: { payload: { 'cognito:groups': allowed ? ['Editors'] : ['Readers'] } } } }) },
    'aws-amplify/storage': {
      copy: async ({ source, destination }: any) => { const blob = assets.get(source.path); if (!blob) throw new Error('Missing file.'); assets.set(destination.path, blob); events.push(`copy:${destination.path}`); },
      list: async ({ path }: any) => ({ items: [...assets.keys()].filter(key => key.startsWith(path)).map(path => ({ path })) }),
      remove: async ({ path }: any) => { if (failCleanup) throw new Error('Cleanup failed.'); assets.delete(path); events.push(`remove:${path}`); },
    },
  };
  const source = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8')
    .replace(/import\.meta\.env\.VITE_APP_MODE/g, JSON.stringify(mode))
    .replace("import.meta.glob('../../amplify_outputs.json',{eager:true,import:'default'})", '{file:{}}');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const exports: any = {};
  vm.runInNewContext(js, { exports, require: (name: string) => { if (!(name in modules)) throw new Error(`Unexpected import ${name}`); return modules[name]; }, crypto: webcrypto, TextEncoder, Blob, URL, Date, JSON, Error });
  return { api: exports, drafts, published, assets, events, ...state };
}

function fixture(): Post {
  return { id: 'original', title: 'A newt-sized story', slug: 'a-newt-sized-story', excerpt: 'Hello', category: 'Stories', status: 'Published', publishedAt: '2026-10-01T00:00:00Z', coverKey: 'drafts/original/cover.jpg', document: JSON.stringify({ version: 1, theme: 'pink', layout: 'story', blocks: [{ id: 'text', type: 'text', nodes: [{ tag: 'p', children: [{ tag: '#text', text: 'Original text' }] }] }, { id: 'photo', type: 'image', key: 'drafts/original/photo.jpg', alt: 'Axolotl' }] }) };
}

test('local duplication creates an independent private draft, fresh block identities, and private media including its cover', async () => {
  const h = harness(), source = fixture(), before = JSON.stringify(source);
  h.drafts.set(source.id, source); h.published.set(source.id, source);
  for (const key of ['drafts/original/photo.jpg', 'drafts/original/cover.jpg']) h.assets.set(key, new Blob(['axolotl']));
  const copy: Post = await h.api.duplicatePost(source), doc = JSON.parse(copy.document);
  assert.notEqual(copy.id, source.id); assert.equal(copy.status, 'Draft'); assert.equal(copy.publishedAt, undefined);
  assert.notEqual(copy.slug, source.slug); assert.match(copy.title, / copy$/);
  assert.ok(doc.blocks.every((block: any, index: number) => block.id !== JSON.parse(source.document).blocks[index].id));
  for (const key of [doc.blocks[1].key, copy.coverKey]) { assert.ok(key!.startsWith(`drafts/${copy.id}/`)); assert.equal(await h.assets.get(key!)!.text(), 'axolotl'); }
  assert.equal(JSON.stringify(source), before); assert.equal(h.published.size, 1);
  await h.api.deletePost(copy);
  assert.equal(h.drafts.has(copy.id), false); assert.equal(h.drafts.has(source.id), true);
  assert.ok(h.assets.has('drafts/original/photo.jpg')); assert.ok(h.assets.has('drafts/original/cover.jpg'));
});

test('editable content comes from the latest private draft rather than the displayed published snapshot', async () => {
  const h = harness(), source = fixture();
  h.published.set(source.id, source); h.drafts.set(source.id, { ...source, title: 'Unsaved from public view' });
  assert.equal((await h.api.getEditablePost(source.id)).title, 'Unsaved from public view');
  await assert.rejects(h.api.getEditablePost('missing'), /no longer available/);
});

test('incomplete copies and interrupted deletions cannot be opened for editing', async () => {
  const h = harness('nce'), source = fixture();
  h.drafts.set(source.id, { ...source, adminState: 'copying', duplicateSourceId: 'previous-source' });
  await assert.rejects(h.api.getEditablePost(source.id), /copy is incomplete.*original post/);
  h.drafts.set(source.id, { ...source, adminState: 'deleting' });
  await assert.rejects(h.api.getEditablePost(source.id), /Deletion is unfinished.*Retry Delete/);
});

test('a failed media copy removes only newly staged files and leaves the original intact', async () => {
  const h = harness(), source = fixture(); h.drafts.set(source.id, source);
  h.assets.set('drafts/original/photo.jpg', new Blob(['photo'])); h.assets.set('drafts/original/cover.jpg', new Blob(['cover']));
  h.failCopy(true);
  await assert.rejects(h.api.duplicatePost(source), /Copy failed/);
  assert.equal(h.drafts.size, 1); assert.deepEqual([...h.assets.keys()].sort(), ['drafts/original/cover.jpg', 'drafts/original/photo.jpg']);
});

test('deleting local published content unpublishes before cleanup and keeps a retryable draft after cleanup failure', async () => {
  const h = harness(), source = fixture(); h.drafts.set(source.id, source); h.published.set(source.id, source);
  h.assets.set('published/original/version/photo.jpg', new Blob(['public'])); h.assets.set('drafts/original/photo.jpg', new Blob(['private']));
  h.failCleanup(true); await assert.rejects(h.api.deletePost(source), /Cleanup failed/);
  assert.equal(h.published.has(source.id), false); assert.equal(h.drafts.has(source.id), true);
  h.failCleanup(false); await h.api.deletePost(source); await h.api.deletePost(source);
  assert.equal(h.drafts.size, 0); assert.equal(h.published.size, 0); assert.equal(h.assets.size, 0);
  assert.equal(h.events[0], 'delete:live:original');
});

test('Cognito duplicate resumes a confirmed draft after an uncertain save instead of creating another copy', async () => {
  const h = harness('cloud'), source = fixture(); h.drafts.set(source.id, source);
  h.assets.set('drafts/original/photo.jpg', new Blob(['photo'])); h.assets.set('drafts/original/cover.jpg', new Blob(['cover']));
  h.uncertainSave(); await assert.rejects(h.api.duplicatePost(source), /Lost save response/);
  const committed = [...h.drafts.values()].find(post => post.id !== source.id)!;
  const copy = await h.api.duplicatePost(source);
  assert.equal(copy.id, committed.id); assert.equal(h.drafts.size, 2); assert.equal(h.events.filter(item => item.startsWith('copy:')).length, 2);
  await h.api.deletePost(copy); await h.api.deletePost(copy);
  assert.equal(h.drafts.size, 1); assert.equal(h.assets.size, 2); assert.ok(h.drafts.has(source.id));
});

test('cloud and Core admin actions reject insufficient permissions before touching content', async () => {
  for (const mode of ['cloud', 'nce'] as const) {
    const h = harness(mode); h.allow(false);
    assert.equal(await h.api.adminSession(), false);
    await assert.rejects(h.api.duplicatePost(fixture()), /administrator access is required/);
    await assert.rejects(h.api.deletePost(fixture()), /administrator access is required/);
    assert.equal(h.events.length, 0);
  }
});

test('Core content actions delegate to authoritative duplicate and complete deletion APIs', async () => {
  const h = harness('nce'), source = fixture(); h.drafts.set(source.id, source);
  assert.equal((await h.api.getEditablePost(source.id)).id, source.id);
  assert.equal((await h.api.duplicatePost(source)).id, 'core-copy');
  await h.api.deletePost(source); assert.deepEqual(h.events, ['core-delete:original']);
});
