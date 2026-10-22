import architecture from '../../config/feedback-architecture.json';
import type { DevelopmentPlan, Feedback, FeedbackArea, FeedbackConfig, FeedbackInput, FeedbackKind, FeedbackStatus } from './feedback-types';

export const feedbackArchitecture = architecture;
export const feedbackKinds: { value: FeedbackKind; label: string }[] = [{ value: 'idea', label: 'I have an idea' }, { value: 'problem', label: 'Something is tricky or broken' }, { value: 'improvement', label: 'Make something better' }];
export const feedbackAreas: { value: FeedbackArea; label: string }[] = architecture.areas.map(area => ({ value: area.id as FeedbackArea, label: area.label }));
export const feedbackStatuses: { value: FeedbackStatus; label: string }[] = [{ value: 'new', label: 'New' }, { value: 'reviewing', label: "We're looking" }, { value: 'planned', label: 'Planned' }, { value: 'building', label: 'Building' }, { value: 'done', label: 'Ready' }, { value: 'declined', label: 'Maybe later' }, { value: 'archived', label: 'Archived' }];
const pages = ['/', '/studio', '/game-studio', '/games', '/posts', '/feedback'];
const knownFiles = new Set([...architecture.releaseFiles, ...architecture.areas.flatMap(area => [...area.files, ...area.tests])]);
function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label} must be an object.`);
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== keys.length || keys.some(key => !Object.hasOwn(data, key))) throw new Error(`${label} has missing or unexpected fields.`);
  return data;
}
export function feedbackText(value: unknown, max: number, label: string, empty = false, multiline = true): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const clean = value.replace(/\r\n?/g, '\n').trim();
  if ((!empty && !clean) || clean.length > max || /[\u0000-\u0009\u000b-\u001f\u007f-\u009f<>]/u.test(clean) || !multiline && clean.includes('\n') || [...clean].some(character => { const code = character.codePointAt(0)!; return code >= 0xd800 && code <= 0xdfff; })) throw new Error(`${label} needs ${empty ? '' : 'nonempty, '}plain text up to ${max} characters, without HTML or control characters.`);
  return clean;
}
export function feedbackPage(path: string): FeedbackInput['page'] {
  const clean = path.split(/[?#]/u)[0];
  if (clean === '/game-studio') return '/game-studio';
  if (clean === '/studio') return '/studio';
  if (clean === '/feedback') return '/feedback';
  if (clean === '/games' || clean.startsWith('/games/')) return '/games';
  if (clean === '/posts' || clean.startsWith('/posts/')) return '/posts';
  return '/';
}
export function emptyFeedbackInput(path: string): FeedbackInput {
  const page = feedbackPage(path), area: FeedbackArea = page === '/game-studio' ? 'game-studio' : page === '/games' ? 'games' : page === '/studio' ? 'editor' : page === '/posts' ? 'stories' : 'general';
  return { title: '', details: '', kind: 'idea', area, page };
}
export function validateFeedbackInput(value: unknown): FeedbackInput {
  const data = object(value, ['title', 'details', 'kind', 'area', 'page'], 'Feedback');
  if (!feedbackKinds.some(kind => kind.value === data.kind) || !feedbackAreas.some(area => area.value === data.area) || !pages.includes(data.page as string)) throw new Error('Choose an available feedback kind, app section, and page.');
  return { title: feedbackText(data.title, 120, 'Title', false, false), details: feedbackText(data.details, 4000, 'Your idea'), kind: data.kind as FeedbackKind, area: data.area as FeedbackArea, page: data.page as FeedbackInput['page'] };
}
export function validateFeedbackReply(value: unknown): string { return feedbackText(value, 2000, 'Reply', true); }
export function validateFeedbackConfig(value: unknown): FeedbackConfig {
  const data = object(value, ['version', 'revision', 'submissionEnabled', 'plannerModeId'], 'Feedback settings');
  if (data.version !== 1 || !Number.isSafeInteger(data.revision) || Number(data.revision) < 0 || Number(data.revision) > 1000000000 || typeof data.submissionEnabled !== 'boolean' || typeof data.plannerModeId !== 'string' || data.plannerModeId !== '' && !/^[a-z][a-z0-9_-]{0,63}$/u.test(data.plannerModeId)) throw new Error('Feedback settings are invalid.');
  return { version: 1, revision: Number(data.revision), submissionEnabled: data.submissionEnabled, plannerModeId: data.plannerModeId };
}
export async function feedbackFingerprint(input: FeedbackInput): Promise<string> {
  const clean = validateFeedbackInput(input), encoded = JSON.stringify([clean.title, clean.details, clean.kind, clean.area, clean.page]);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function validateDevelopmentPlan(value: unknown): DevelopmentPlan {
  const data = object(value, ['summary', 'approach', 'steps', 'acceptanceCriteria', 'tests', 'risks', 'questions', 'effort'], 'Development plan');
  const list = (input: unknown, min: number, max: number, label: string): string[] => {
    if (!Array.isArray(input) || input.length < min || input.length > max) throw new Error(`${label} needs ${min} to ${max} items.`);
    return input.map(item => feedbackText(item, 500, label));
  };
  if (!Array.isArray(data.steps) || data.steps.length < 1 || data.steps.length > 8) throw new Error('A development plan needs 1 to 8 steps.');
  const steps = data.steps.map(value => {
    const step = object(value, ['title', 'details', 'files'], 'Development step');
    if (!Array.isArray(step.files) || step.files.length > 6 || step.files.some(file => typeof file !== 'string' || !knownFiles.has(file)) || new Set(step.files).size !== step.files.length) throw new Error('A plan can reference only known application files.');
    return { title: feedbackText(step.title, 140, 'Step title', false, false), details: feedbackText(step.details, 1000, 'Step details'), files: [...step.files] as string[] };
  });
  if (!['small', 'medium', 'large'].includes(data.effort as string)) throw new Error('Choose a small, medium, or large effort.');
  return { summary: feedbackText(data.summary, 700, 'Summary'), approach: feedbackText(data.approach, 2500, 'Approach'), steps, acceptanceCriteria: list(data.acceptanceCriteria, 1, 8, 'Acceptance criteria'), tests: list(data.tests, 1, 8, 'Tests'), risks: list(data.risks, 0, 6, 'Risks'), questions: list(data.questions, 0, 6, 'Questions'), effort: data.effort as DevelopmentPlan['effort'] };
}

/** An honest no-provider starting brief, rather than a claim of model reasoning. */
export function guidedDevelopmentPlan(value: FeedbackInput): DevelopmentPlan {
  const input = validateFeedbackInput(value), area = architecture.areas.find(area => area.id === input.area)!;
  return validateDevelopmentPlan({
    summary: `Turn “${input.title}” into a small, reviewable change for ${area.label.toLowerCase()}.`,
    approach: `${area.approach} This guided starting brief uses the supplied request and the application's architecture snapshot; it has not inspected the live repository or executed a model.`,
    steps: [
      { title: 'Agree on the desired experience', details: `Use this request as the starting point: ${Array.from(input.details).slice(0, 320).join('')} Resolve the open questions and describe one concrete before-and-after example.`, files: [] },
      { title: 'Implement the smallest useful change', details: area.approach, files: area.files.slice(0, 6) },
      { title: 'Verify behavior and access', details: area.validation, files: area.tests.slice(0, 6) },
      { title: 'Review the result and prepare the release', details: 'Let the creator try the result, record the review, and release the same tested source. If the API changes, release it before the frontend. Preserve existing content and configuration.', files: architecture.releaseFiles },
    ],
    acceptanceCriteria: [`The intended user can complete the requested outcome: ${input.title}.`, `Existing ${area.label.toLowerCase()} features and private/public boundaries remain usable.`, 'The reviewer can demonstrate the agreed example before marking the feedback Ready.'],
    tests: [area.validation, 'Run the relevant application tests and normal production build, then verify the changed user flow in the browser.'],
    risks: ['The request may need clarification before its implementation scope and effort can be confirmed.', 'Estimate any new infrastructure, provider usage, or access requirements before choosing that approach.'],
    questions: [area.question, 'Which part is essential for the first version, and what can wait?'],
    effort: input.area === 'games' || input.area === 'game-studio' || input.area === 'agents' || input.details.length > 2000 ? 'medium' : 'small',
  });
}

export function exportFeedbackBrief(item: Feedback): string {
  const proposal = item.proposal;
  if (!proposal || proposal.stale || !proposal.approvedAt) throw new Error('Approve a current development proposal before exporting its execution brief.');
  const plan = validateDevelopmentPlan(proposal.plan), escape = (text: string) => text.replace(/[\\`*_\[\]<>!]/gu, '\\$&');
  const section = (name: string, values: string[]) => `## ${name}\n\n${values.length ? values.map(value => `- ${escape(value).replaceAll('\n', '\n  ')}`).join('\n') : 'None recorded.'}\n`;
  return [`# ${escape(item.title)}`, `Approved development proposal · ${proposal.origin === 'agent' ? 'AI-assisted' : 'Guided starting brief'}\n\nApproved: ${proposal.approvedAt}\nArchitecture snapshot: ${proposal.contextVersion}\nFeedback fingerprint: ${proposal.sourceFingerprint}\n\nApproval records the chosen approach. Execution is a separate step.`, `## Original feedback\n\n${item.details.split('\n').map(line => `> ${escape(line)}`).join('\n')}`, `## Outcome\n\n${escape(plan.summary)}`, `## Approach\n\n${escape(plan.approach)}`, `## Implementation steps\n\n${plan.steps.map((step, index) => `${index + 1}. **${escape(step.title)}**\n\n   ${escape(step.details).replaceAll('\n', '\n   ')}${step.files.length ? `\n\n   Files to inspect: ${step.files.map(file => `\`${file}\``).join(', ')}` : ''}`).join('\n\n')}`, section('Acceptance criteria', plan.acceptanceCriteria), section('Validation', plan.tests), section('Risks', plan.risks), section('Open questions', plan.questions), `## Effort\n\n${plan.effort} (provisional scope assessment, not a delivery estimate).`].join('\n\n') + '\n';
}
