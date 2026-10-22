import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { emptyFeedbackInput, exportFeedbackBrief, feedbackArchitecture, feedbackFingerprint, feedbackPage, guidedDevelopmentPlan, validateDevelopmentPlan, validateFeedbackInput } from '../src/lib/feedback-model.ts';
import type { Feedback, FeedbackInput } from '../src/lib/feedback-types.ts';

const input: FeedbackInput = { ...emptyFeedbackInput('/game-studio?game=private&token=secret'), title: 'Let my axolotl dash', details: 'I want a button that lets me swim quickly for a moment. It should recharge after I use it.' };

test('feedback context records only a known app section, never queries or content identifiers', () => {
  assert.equal(feedbackPage('/games/secret-id?code=private#draft'), '/games');
  assert.equal(feedbackPage('/posts/a-story/private-id?token=secret'), '/posts');
  assert.equal(feedbackPage('/oauth/callback?code=private'), '/');
  assert.equal(input.page, '/game-studio'); assert.equal(input.area, 'game-studio');
  assert.throws(() => validateFeedbackInput({ ...input, page: '/game-studio?token=private' }));
  assert.throws(() => validateFeedbackInput({ ...input, document: 'private unsaved content' }));
});

test('feedback accepts concise multiline prose and normalizes it consistently', async () => {
  const normalized = validateFeedbackInput({ ...input, title: '  Dash idea  ', details: ' First line\r\nSecond line\rThird line ' });
  assert.equal(normalized.title, 'Dash idea'); assert.equal(normalized.details, 'First line\nSecond line\nThird line');
  assert.match(validateFeedbackInput({ ...input, details: 'This happened at https://example.com' }).details, /https:/);
  for (const details of ['', '\u0000hidden', '<script>alert(1)</script>', 'a'.repeat(4001), '\ud800']) assert.throws(() => validateFeedbackInput({ ...input, details }));
  assert.throws(() => validateFeedbackInput({ ...input, title: '🐟'.repeat(61) }));
  assert.throws(() => validateFeedbackInput({ ...input, title: 'Multiple\nlines' }));
  assert.equal(await feedbackFingerprint(normalized), await feedbackFingerprint({ ...normalized }));
  assert.notEqual(await feedbackFingerprint(normalized), await feedbackFingerprint({ ...normalized, details: normalized.details + '!' }));
});

test('architecture context references real application files and guided plans stay grounded', () => {
  for (const area of feedbackArchitecture.areas) {
    for (const file of [...area.files, ...area.tests]) assert.ok(existsSync(file), `Missing architecture path: ${file}`);
    const plan = guidedDevelopmentPlan({ ...input, area: area.id as FeedbackInput['area'] });
    assert.deepEqual(validateDevelopmentPlan(plan), plan);
    assert.match(plan.summary, /Let my axolotl dash/);
    assert.match(plan.approach, /has not inspected the live repository or executed a model/);
    assert.ok(plan.steps.some(step => step.files.length > 0));
  }
  assert.doesNotThrow(() => guidedDevelopmentPlan({ ...input, details: '🐟'.repeat(2000) }));
});

test('development plans reject unknown files, arbitrary actions, and unbounded model output', () => {
  const good = guidedDevelopmentPlan(input);
  for (const mutation of [
    (plan: typeof good) => { plan.steps[0].files = ['../../.aws/credentials']; },
    (plan: typeof good) => { plan.steps[0].files = ['src/new-invented-executor.ts']; },
    (plan: typeof good) => { plan.steps[0].files = ['src/App.tsx', 'src/App.tsx']; },
    (plan: typeof good) => { plan.steps = []; },
    (plan: typeof good) => { plan.acceptanceCriteria = []; },
    (plan: typeof good) => { plan.summary = 'x'.repeat(701); },
    (plan: typeof good) => { Object.assign(plan, { execute: 'deploy now' }); },
  ]) { const candidate = structuredClone(good); mutation(candidate); assert.throws(() => validateDevelopmentPlan(candidate)); }
});

test('only a current approved proposal exports an execution brief, with quoted author text', async () => {
  const item: Feedback = { ...input, details: 'Add [my image](https://example.com/pixel) please.', id: '11111111-1111-4111-8111-111111111111', revision: 1, status: 'new', reply: '', createdAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T00:00:00.000Z', own: true };
  assert.throws(() => exportFeedbackBrief(item));
  const source: FeedbackInput = { title: item.title, details: item.details, kind: item.kind, area: item.area, page: item.page };
  item.proposal = { id: '22222222-2222-4222-8222-222222222222', plan: guidedDevelopmentPlan(source), sourceFingerprint: await feedbackFingerprint(source), sourceRevision: 0, createdAt: item.createdAt, origin: 'guided', agentName: 'Guided planner', modelName: 'No model call', contextVersion: 1, stale: false };
  assert.throws(() => exportFeedbackBrief(item));
  item.proposal.approvedAt = item.updatedAt;
  const brief = exportFeedbackBrief(item);
  assert.match(brief, /Execution is a separate step/); assert.match(brief, /## Acceptance criteria/);
  assert.match(brief, /> Add \\\[my image\\\]/); assert.doesNotMatch(brief, /!\[|<script/);
  assert.match(brief, /src\/components\/GameStudio\.tsx/);
  item.proposal.stale = true; assert.throws(() => exportFeedbackBrief(item));
});

test('browser and API input, fingerprint, and guided approach match across every app area', async () => {
  const cases = feedbackArchitecture.areas.map(area => ({ ...input, area: area.id as FeedbackInput['area'] }));
  cases.push({ ...input, title: 'Pink 🐟 explorer', details: '  First\r\nSecond\rThird 🦎  ' });
  cases.push({ ...input, details: '🐟'.repeat(2000) });
  const program = `import importlib.util,json,sys\nfrom pathlib import Path\ns=importlib.util.spec_from_file_location('feedback_parity',Path.cwd()/'backend/nce_api/feedback.py')\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nresult=[]\nfor case in json.load(sys.stdin):\n clean=m.validate_input(case)\n result.append({'input':clean,'fingerprint':m.fingerprint(clean),'plan':m.guided_plan(clean)})\nprint(json.dumps(result,ensure_ascii=False))`;
  const actual = JSON.parse(execFileSync('python3', ['-c', program], { input: JSON.stringify(cases), encoding: 'utf8' }));
  for (const [index, value] of cases.entries()) {
    const clean = validateFeedbackInput(value);
    assert.deepEqual(actual[index], { input: clean, fingerprint: await feedbackFingerprint(clean), plan: guidedDevelopmentPlan(clean) }, `Case ${index}`);
  }
});
