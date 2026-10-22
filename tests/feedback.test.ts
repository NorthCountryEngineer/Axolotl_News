import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalFeedbackLibrary, type FeedbackActor } from '../src/lib/feedback-local.ts';
import { feedbackFingerprint } from '../src/lib/feedback-model.ts';
import type { FeedbackInput } from '../src/lib/feedback-types.ts';

const id = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222', requestId = '33333333-3333-4333-8333-333333333333';
const admin: FeedbackActor = { id: '00000000-0000-4000-8000-000000000001', canReview: true, canConfigure: true };
const child: FeedbackActor = { id: '00000000-0000-4000-8000-000000000002', canReview: false, canConfigure: false };
const sibling: FeedbackActor = { id: '00000000-0000-4000-8000-000000000003', canReview: false, canConfigure: false };
const idea: FeedbackInput = { title: 'A friend for my axolotl', details: 'I want a second character to follow me through the pond levels.', kind: 'idea', area: 'games', page: '/game-studio' };
const key = 'axolotl-feedback-v1';
function library() {
  const values = new Map<string, string>();
  const storage = { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => { values.set(name, value); } };
  return { values, storage, parent: new LocalFeedbackLibrary(storage, admin), child: new LocalFeedbackLibrary(storage, child), sibling: new LocalFeedbackLibrary(storage, sibling) };
}

test('feedback is private to its author and reviewers and child responses omit planning internals', async () => {
  const { parent, child: author, sibling: other } = library();
  const first = await author.create(id, idea);
  assert.equal(first.own, true); assert.equal(first.revision, 0); assert.equal(first.status, 'new'); assert.equal(first.reply, '');
  const planned = await parent.propose(id, first.revision, requestId);
  assert.equal(planned.own, false); assert.equal(planned.authorId, child.id); assert.equal(planned.proposal?.origin, 'guided');
  const childView = await author.get(id);
  assert.equal(childView.proposal, undefined); assert.equal(childView.authorId, undefined); assert.equal(childView.planningState, undefined); assert.equal(childView.planningError, undefined);
  assert.deepEqual(Object.keys(childView).sort(), ['title', 'details', 'kind', 'area', 'page', 'id', 'revision', 'status', 'reply', 'createdAt', 'updatedAt', 'own'].sort());
  assert.equal((await author.list()).length, 1); assert.deepEqual(await other.list(), []);
  await assert.rejects(other.get(id), /could not be found/);
  await assert.rejects(other.update(id, planned.revision, { ...idea, title: 'Someone else’s edit' }), /could not be found/);
  assert.equal((await parent.list()).length, 1);
});

test('feedback create retries are idempotent by original author and input even after review', async () => {
  const { parent, child: author, sibling: other } = library();
  const first = await author.create(id, idea), reviewed = await parent.review(id, first.revision, 'reviewing', 'I will take a look.');
  assert.deepEqual(await author.create(id, idea), await author.get(id));
  assert.equal((await author.create(id, idea)).revision, reviewed.revision);
  await assert.rejects(author.create(id, { ...idea, title: 'Different request' }), /another request/);
  await assert.rejects(other.create(id, idea), /another request/);
  const edited = await author.update(id, reviewed.revision, { ...idea, details: 'Now I would like two friends.' });
  assert.equal((await author.create(id, idea)).revision, edited.revision);
  assert.equal((await author.list()).length, 1);
});

test('submission pause blocks new requests, copies, and author edits while retaining parent recovery', async () => {
  const { parent, child: author } = library(), first = await author.create(id, idea), settings = await parent.settings();
  await parent.saveSettings({ ...settings.config, submissionEnabled: false }, settings.config.revision);
  await assert.rejects(author.create(second, idea), /paused/);
  await assert.rejects(parent.duplicate(id, first.revision, second), /paused/);
  await assert.rejects(author.update(id, first.revision, { ...idea, title: 'An edit' }), /paused/);
  assert.equal((await author.create(id, idea)).id, id);
  const edited = await parent.update(id, first.revision, { ...idea, title: 'Clarified by parent' });
  const reviewed = await parent.review(id, edited.revision, 'reviewing', 'We can still talk about this.');
  const planned = await parent.propose(id, reviewed.revision, requestId);
  assert.equal(planned.proposal?.origin, 'guided'); assert.equal((await author.get(id)).reply, 'We can still talk about this.');
  await parent.delete(id, planned.revision); assert.deepEqual(await author.list(), []);
});

test('review status is a human decision and authors can edit only new or reviewing feedback', async () => {
  const { parent, child: author } = library(), first = await author.create(id, idea);
  const plan = await parent.propose(id, first.revision, requestId);
  assert.equal(plan.status, 'new');
  const approved = await parent.approve(id, plan.revision, plan.proposal!.id);
  assert.equal(approved.status, 'new');
  const reviewed = await parent.review(id, approved.revision, 'planned', 'Let’s build this next.');
  await assert.rejects(author.update(id, reviewed.revision, { ...idea, title: 'Changed after planning' }), /already being worked on/);
  const reopened = await parent.review(id, reviewed.revision, 'reviewing', 'Tell me more.');
  const changed = await author.update(id, reopened.revision, { ...idea, details: 'The friend should swim slowly.' });
  assert.equal(changed.details, 'The friend should swim slowly.');
  await assert.rejects(author.review(id, changed.revision, 'done', 'I finished it'), /reviewer/);
  await assert.rejects(parent.review(id, changed.revision, 'automatic' as 'new', ''), /valid feedback status/);
});

test('approval is tied to current input, while status and replies do not invalidate a proposal', async () => {
  const { parent, child: author } = library(), first = await author.create(id, idea), plan = await parent.propose(id, first.revision, requestId);
  assert.equal(plan.proposal!.sourceFingerprint, await feedbackFingerprint(idea));
  assert.equal(plan.proposal!.sourceRevision, first.revision); assert.equal(plan.proposal!.stale, false);
  const reviewed = await parent.review(id, plan.revision, 'reviewing', 'This looks like a good first version.');
  assert.equal(reviewed.proposal!.stale, false);
  const approved = await parent.approve(id, reviewed.revision, reviewed.proposal!.id);
  assert.ok(approved.proposal!.approvedAt); assert.equal(approved.proposal!.stale, false);
  const changed = await author.update(id, approved.revision, { ...idea, details: 'Now the friend must jump and collect food.' });
  assert.equal(changed.proposal, undefined);
  const parentView = await parent.get(id);
  assert.equal(parentView.proposal!.stale, true); assert.equal(parentView.proposal!.approvedAt, undefined);
  await assert.rejects(parent.approve(id, parentView.revision, parentView.proposal!.id), /current development proposal/);
});

test('planning retries never create another proposal or revision and configured modes remain free in preview', async () => {
  const { parent } = library(), settings = await parent.settings();
  await parent.saveSettings({ ...settings.config, plannerModeId: 'development-agent' }, settings.config.revision);
  const first = await parent.create(id, idea), plan = await parent.propose(id, first.revision, requestId);
  assert.equal(plan.proposal!.origin, 'guided'); assert.match(plan.proposal!.modelName, /No model/);
  assert.deepEqual(await parent.propose(id, first.revision, requestId), plan);
  await assert.rejects(parent.propose(id, plan.revision, requestId), /different revision/);
  const edited = await parent.update(id, plan.revision, { ...idea, title: 'A changed request' });
  await assert.rejects(parent.propose(id, first.revision, requestId), /already used/);
  const current = await parent.get(id);
  assert.equal(current.revision, edited.revision); assert.equal(current.proposal!.id, plan.proposal!.id); assert.equal(current.proposal!.stale, true);
});

test('every mutation rejects stale revisions and returned objects cannot mutate saved feedback', async () => {
  const { parent } = library(), first = await parent.create(id, idea), next = await parent.review(id, first.revision, 'reviewing', 'Hello');
  await assert.rejects(parent.update(id, first.revision, idea), /another window/);
  await assert.rejects(parent.review(id, first.revision, 'done', ''), /another window/);
  await assert.rejects(parent.propose(id, first.revision, requestId), /another window/);
  await assert.rejects(parent.duplicate(id, first.revision, second), /another window/);
  await assert.rejects(parent.delete(id, first.revision), /another window/);
  next.title = 'Changed outside storage';
  assert.equal((await parent.get(id)).title, idea.title);
  const plan = await parent.propose(id, next.revision, requestId);
  plan.proposal!.plan.steps[0].title = 'Changed outside storage';
  assert.notEqual((await parent.get(id)).proposal!.plan.steps[0].title, 'Changed outside storage');
  await assert.rejects(parent.approve(id, next.revision, plan.proposal!.id), /another window/);
  await assert.rejects(parent.approve(id, plan.revision, second), /current development proposal/);
});

test('only reviewers can plan, approve, duplicate, delete, and read other authors', async () => {
  const { parent, child: author } = library(), first = await author.create(id, idea), plan = await parent.propose(id, first.revision, requestId);
  await assert.rejects(author.propose(id, plan.revision, second), /reviewer/);
  await assert.rejects(author.approve(id, plan.revision, plan.proposal!.id), /reviewer/);
  await assert.rejects(author.duplicate(id, plan.revision, second), /reviewer/);
  await assert.rejects(author.delete(id, plan.revision), /reviewer/);
  const copy = await parent.duplicate(id, plan.revision, second);
  assert.equal(copy.title, `Copy of ${idea.title}`); assert.equal(copy.status, 'new'); assert.equal(copy.revision, 0); assert.equal(copy.reply, ''); assert.equal(copy.own, true); assert.equal(copy.authorId, admin.id); assert.equal(copy.proposal, undefined);
  assert.equal((await author.list()).length, 1); await assert.rejects(author.get(second), /could not be found/);
});

test('delete removes private feedback and leaves a tombstone that blocks stale resurrection', async () => {
  const { parent, child: author } = library(), first = await author.create(id, idea);
  await parent.delete(id, first.revision); assert.deepEqual(await parent.list(), []);
  await assert.rejects(parent.get(id), /could not be found/);
  await assert.rejects(author.create(id, idea), /deleted/);
  const next = await parent.create(second, idea);
  await assert.rejects(parent.duplicate(second, next.revision, id), /already exists/);
});

test('settings require configuration permission and optimistic concurrency, and do not leak planner names to children', async () => {
  const { storage, parent, child: author } = library(), first = await parent.settings();
  assert.equal(first.canReview, true); assert.equal(first.canConfigure, true); assert.equal(first.canPlan, true);
  const next = await parent.saveSettings({ ...first.config, plannerModeId: 'feedback-planner' }, first.config.revision);
  assert.equal(next.config.revision, 1);
  await assert.rejects(parent.saveSettings(first.config, first.config.revision), /changed/);
  await assert.rejects(parent.saveSettings({ ...next.config, revision: 8 }, next.config.revision), /changed/);
  await assert.rejects(author.saveSettings(next.config, next.config.revision), /administrator/);
  const limited = await author.settings(); assert.equal(limited.canReview, false); assert.equal(limited.canConfigure, false); assert.equal(limited.canPlan, false); assert.equal(limited.config.plannerModeId, '');
  const reviewer = new LocalFeedbackLibrary(storage, { ...sibling, canReview: true });
  assert.equal((await reviewer.settings()).canPlan, true);
  await assert.rejects(reviewer.saveSettings(next.config, next.config.revision), /administrator/);
});

test('malformed or prototype-shaped saved data fail without replacing it or affecting newsroom storage', async () => {
  const { parent, values } = library(); values.set('axolotl-news:posts', 'keep me');
  await parent.create(id, idea); const valid = values.get(key)!;
  for (const malformed of ['{', '{}', 'null', '{"__proto__":{}}', valid.replace('"items":[', '"items":[').replace('"status":"new"', '"status":"unsafe"'), valid.replace('"receipts":{', '"receipts":{"__proto__":[],')]) {
    values.set(key, malformed); await assert.rejects(parent.list(), /could not be read/); assert.equal(values.get(key), malformed);
  }
  assert.equal(values.get('axolotl-news:posts'), 'keep me');
  values.set(key, valid); assert.equal((await parent.list()).length, 1);
});

test('storage failures preserve previous saved feedback and empty storage is not silently reset', async () => {
  const { parent, storage, values } = library(); await parent.create(id, idea); const before = values.get(key);
  const unavailable = new LocalFeedbackLibrary({ getItem: storage.getItem, setItem: () => { throw new Error('Quota exceeded'); } });
  await assert.rejects(unavailable.create(second, idea), /could not be saved/); assert.equal(values.get(key), before);
  values.set(key, ''); await assert.rejects(parent.settings(), /could not be read/); assert.equal(values.get(key), '');
  const unreadable = new LocalFeedbackLibrary({ getItem: () => { throw new Error('Storage disabled'); }, setItem: storage.setItem });
  await assert.rejects(unreadable.list(), /could not be read/);
});

test('a concurrent content edit during fingerprinting cannot be overwritten by planning or approval', async () => {
  const { parent } = library(), first = await parent.create(id, idea);
  const pending = assert.rejects(parent.propose(id, first.revision, requestId), /another window/);
  const changed = await parent.update(id, first.revision, { ...idea, title: 'A newer idea' });
  await pending; assert.equal((await parent.get(id)).title, changed.title); assert.equal((await parent.get(id)).proposal, undefined);
  const plan = await parent.propose(id, changed.revision, second);
  const approval = assert.rejects(parent.approve(id, plan.revision, plan.proposal!.id), /another window/);
  await parent.update(id, plan.revision, { ...idea, title: 'Another newer idea' });
  await approval; assert.equal((await parent.get(id)).proposal!.approvedAt, undefined);
});

test('request planning is bounded and cannot be restarted by replaying or changing an old receipt', async () => {
  const { parent } = library(); let item = await parent.create(id, idea);
  for (let index = 0; index < 40; index++) item = await parent.propose(id, item.revision, `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`);
  await assert.rejects(parent.propose(id, item.revision, requestId), /planning limit/);
  const copy = await parent.duplicate(id, item.revision, second);
  assert.equal((await parent.propose(second, copy.revision, requestId)).proposal!.origin, 'guided');
});

test('copies preserve whole Unicode characters within the title limit', async () => {
  const { parent } = library(), first = await parent.create(id, { ...idea, title: '🦎'.repeat(60) }), copy = await parent.duplicate(id, first.revision, second);
  assert.equal(copy.title, 'Copy of ' + '🦎'.repeat(56)); assert.equal(copy.title.length, 120);
  assert.equal((await parent.get(second)).title, copy.title);
});

test('a lost duplicate response can be recovered after source edits and a submission pause', async () => {
  const { parent } = library(), source = await parent.create(id, idea), original = await parent.duplicate(id, source.revision, second);
  const changed = await parent.update(id, source.revision, { ...idea, title: 'A new version of the original' });
  const copy = await parent.review(second, original.revision, 'reviewing', 'We are reviewing this copy.');
  const settings = await parent.settings(); await parent.saveSettings({ ...settings.config, submissionEnabled: false }, settings.config.revision);
  assert.deepEqual(await parent.duplicate(id, source.revision, second), copy);
  assert.equal((await parent.list()).length, 2);
  await assert.rejects(parent.duplicate(id, changed.revision, second), /already exists/);
  await assert.rejects(parent.duplicate(id, source.revision, requestId), /another window/);
  await assert.rejects(parent.duplicate(id, changed.revision, requestId), /paused/);
});

test('duplicate recovery rejects collisions and deleted targets but retains an existing copy after source deletion', async () => {
  const { storage, parent } = library(), source = await parent.create(id, idea), copy = await parent.duplicate(id, source.revision, second);
  const reviewer = new LocalFeedbackLibrary(storage, { ...sibling, canReview: true });
  await assert.rejects(reviewer.duplicate(id, source.revision, second), /already exists/);
  await assert.rejects(parent.duplicate(second, copy.revision, id), /already exists/);
  const ordinary = await parent.create(requestId, idea);
  await assert.rejects(parent.duplicate(id, source.revision, requestId), /already exists/);
  await parent.delete(second, copy.revision);
  await assert.rejects(parent.duplicate(id, source.revision, second), /already exists/);
  const thirdId = '44444444-4444-4444-8444-444444444444';
  const third = await parent.duplicate(requestId, ordinary.revision, thirdId); await parent.delete(requestId, ordinary.revision);
  assert.deepEqual(await parent.duplicate(requestId, ordinary.revision, thirdId), third);
  await assert.rejects(parent.duplicate(requestId, ordinary.revision, '55555555-5555-4555-8555-555555555555'), /could not be found/);
});

test('a copied title trimmed at the limit does not retain trailing whitespace', async () => {
  const { parent } = library(), title = 'x'.repeat(111) + ' ' + 'y'.repeat(8), source = await parent.create(id, { ...idea, title });
  const copy = await parent.duplicate(id, source.revision, second);
  assert.equal(copy.title, 'Copy of ' + 'x'.repeat(111)); assert.equal(copy.title.length, 119);
});

test('saving identical input clears pending and uncertain planning without discarding a current approval', async () => {
  for (const planningState of ['pending', 'uncertain']) {
    const { parent, child: author, values } = library(), first = await author.create(id, idea), plan = await parent.propose(id, first.revision, requestId);
    const approved = await parent.approve(id, plan.revision, plan.proposal!.id);
    const state = JSON.parse(values.get(key)!); state.items[0].planningState = planningState; state.items[0].planningError = 'The prior result is unconfirmed.'; values.set(key, JSON.stringify(state));
    assert.equal((await parent.get(id)).planningState, planningState);
    assert.equal((await author.get(id)).planningState, undefined); assert.equal((await author.get(id)).planningError, undefined);
    await assert.rejects(parent.propose(id, approved.revision, second), /will not be replayed/);
    await assert.rejects(parent.review(id, approved.revision, 'planned', ''), /Wait for planning/);
    const edited = await parent.update(id, approved.revision, idea);
    assert.equal(edited.revision, approved.revision + 1); assert.equal(edited.planningState, undefined); assert.equal(edited.planningError, undefined);
    assert.equal(edited.proposal!.approvedAt, approved.proposal!.approvedAt); assert.equal(edited.proposal!.stale, false);
    assert.equal((await parent.get(id)).planningState, undefined);
    assert.equal((await parent.propose(id, edited.revision, second)).proposal!.origin, 'guided');
  }
});
