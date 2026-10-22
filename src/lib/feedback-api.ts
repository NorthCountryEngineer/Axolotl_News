import { coreRequest, isCore } from './core';
import { LocalFeedbackLibrary } from './feedback-local';
import { validateFeedbackConfig, validateFeedbackInput, validateFeedbackReply } from './feedback-model';
import type { Feedback, FeedbackConfig, FeedbackInput, FeedbackSettings, FeedbackStatus } from './feedback-types';

function local(): LocalFeedbackLibrary {
  if (import.meta.env.VITE_APP_MODE === 'cloud') throw new Error('Feedback requires the NCE Core API deployment. It is unavailable in the legacy backend.');
  return new LocalFeedbackLibrary(localStorage);
}
export async function getFeedbackSettings(): Promise<FeedbackSettings> { return isCore ? coreRequest('/feedback/settings') : local().settings(); }
export async function saveFeedbackSettings(config: FeedbackConfig, expectedRevision: number): Promise<FeedbackSettings> {
  const clean = validateFeedbackConfig(config);
  return isCore ? coreRequest('/feedback/settings', 'PUT', { config: clean, expectedRevision }) : local().saveSettings(clean, expectedRevision);
}
export async function listFeedback(): Promise<Feedback[]> {
  if (!isCore) return local().list();
  const feedback: Feedback[] = [], seen = new Set<string>(); let cursor: string | undefined;
  do {
    const page: { feedback: Feedback[]; cursor?: string } = await coreRequest(`/feedback${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (!page || !Array.isArray(page.feedback) || page.cursor !== undefined && (typeof page.cursor !== 'string' || !page.cursor)) throw new Error('The feedback inbox returned an invalid page. Reload and try again.');
    feedback.push(...page.feedback); cursor = page.cursor;
    if (cursor && seen.has(cursor)) throw new Error('The feedback inbox returned a repeated page. Reload and try again.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return feedback;
}
export async function getFeedback(id: string): Promise<Feedback> { return isCore ? coreRequest(`/feedback/${encodeURIComponent(id)}`) : local().get(id); }
export async function createFeedback(id: string, input: FeedbackInput): Promise<Feedback> { const clean = validateFeedbackInput(input); return isCore ? coreRequest('/feedback', 'POST', { id, input: clean }) : local().create(id, clean); }
export async function updateFeedback(item: Feedback, input: FeedbackInput): Promise<Feedback> { const clean = validateFeedbackInput(input); return isCore ? coreRequest(`/feedback/${encodeURIComponent(item.id)}`, 'PUT', { revision: item.revision, input: clean }) : local().update(item.id, item.revision, clean); }
export async function reviewFeedback(item: Feedback, status: FeedbackStatus, reply: string): Promise<Feedback> { const clean = validateFeedbackReply(reply); return isCore ? coreRequest(`/feedback/${encodeURIComponent(item.id)}/review`, 'POST', { revision: item.revision, status, reply: clean }) : local().review(item.id, item.revision, status, clean); }
export async function proposeFeedback(item: Feedback, requestId: string): Promise<Feedback> { return isCore ? coreRequest(`/feedback/${encodeURIComponent(item.id)}/propose`, 'POST', { revision: item.revision, requestId }) : local().propose(item.id, item.revision, requestId); }
export async function approveFeedbackProposal(item: Feedback): Promise<Feedback> {
  if (!item.proposal) throw new Error('Generate and review a current development proposal before approving it.');
  return isCore ? coreRequest(`/feedback/${encodeURIComponent(item.id)}/approve`, 'POST', { revision: item.revision, proposalId: item.proposal.id }) : local().approve(item.id, item.revision, item.proposal.id);
}
export async function duplicateFeedback(item: Feedback, id: string = crypto.randomUUID()): Promise<Feedback> { return isCore ? coreRequest(`/feedback/${encodeURIComponent(item.id)}/duplicate`, 'POST', { revision: item.revision, id }) : local().duplicate(item.id, item.revision, id); }
export async function deleteFeedback(item: Feedback): Promise<void> { if (isCore) { await coreRequest(`/feedback/${encodeURIComponent(item.id)}`, 'DELETE', { revision: item.revision }); return; } await local().delete(item.id, item.revision); }
