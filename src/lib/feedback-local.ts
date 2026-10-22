import { feedbackFingerprint, guidedDevelopmentPlan, validateDevelopmentPlan, validateFeedbackConfig, validateFeedbackInput, validateFeedbackReply } from './feedback-model';
import type { Feedback, FeedbackConfig, FeedbackInput, FeedbackProposal, FeedbackSettings, FeedbackStatus } from './feedback-types';

type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
export type FeedbackActor = { id: string; canReview: boolean; canConfigure: boolean };
type SavedFeedback = Omit<Feedback, 'own' | 'authorId'> & { authorId: string };
type Receipt = { id: string; revision: number; fingerprint: string; proposalId: string };
type Creation = { authorId: string; input: FeedbackInput; duplicateFrom?: { id: string; revision: number } };
type State = { config: FeedbackConfig; items: SavedFeedback[]; creates: Record<string, Creation>; receipts: Record<string, Receipt[]>; deleted: string[] };

const storageKey = 'axolotl-feedback-v1';
const maximumBytes = 3500000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fingerprintPattern = /^[0-9a-f]{64}$/;
const statuses: FeedbackStatus[] = ['new', 'reviewing', 'planned', 'building', 'done', 'declined', 'archived'];
export const localFeedbackActor: FeedbackActor = { id: '00000000-0000-4000-8000-000000000001', canReview: true, canConfigure: true };
const copy = <T,>(value: T): T => structuredClone(value);
const stamp = () => new Date().toISOString();
function identifier(value: unknown): asserts value is string { if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Choose a valid feedback or request identifier.'); }
function revision(value: unknown): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Choose a valid saved feedback revision.'); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exact(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!object(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw new Error('Unexpected saved feedback fields.');
}
function date(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid saved feedback date.'); }
function sameInput(a: FeedbackInput, b: FeedbackInput) { return a.title === b.title && a.details === b.details && a.kind === b.kind && a.area === b.area && a.page === b.page; }
function inputOf(value: FeedbackInput): FeedbackInput { return { title: value.title, details: value.details, kind: value.kind, area: value.area, page: value.page }; }
function copyTitle(title: string): string { let result = 'Copy of '; for (const character of title) { if (result.length + character.length > 120) break; result += character; } return result.trimEnd(); }
function initial(): State { return { config: { version: 1, revision: 0, submissionEnabled: true, plannerModeId: '' }, items: [], creates: {}, receipts: {}, deleted: [] }; }
function validateProposal(value: unknown): asserts value is FeedbackProposal {
  exact(value, ['id', 'plan', 'sourceFingerprint', 'sourceRevision', 'createdAt', 'origin', 'agentName', 'modelName', 'contextVersion', 'stale'], ['approvedAt']);
  identifier(value.id); validateDevelopmentPlan(value.plan as FeedbackProposal['plan']); revision(value.sourceRevision); date(value.createdAt);
  if (typeof value.sourceFingerprint !== 'string' || !fingerprintPattern.test(value.sourceFingerprint) || !['guided', 'agent'].includes(value.origin as string) || !Number.isSafeInteger(value.contextVersion) || (value.contextVersion as number) < 1 || typeof value.stale !== 'boolean') throw new Error('Invalid saved development proposal.');
  for (const name of [value.agentName, value.modelName]) if (typeof name !== 'string' || name.length > 120 || /[\x00-\x1f\x7f-\x9f<>]/.test(name)) throw new Error('Invalid saved planner name.');
  if (value.approvedAt !== undefined) date(value.approvedAt);
}
function validateSaved(value: unknown): asserts value is SavedFeedback {
  exact(value, ['id', 'revision', 'status', 'reply', 'createdAt', 'updatedAt', 'authorId', 'title', 'details', 'kind', 'area', 'page'], ['proposal', 'planningState', 'planningError']);
  identifier(value.id); identifier(value.authorId); revision(value.revision); date(value.createdAt); date(value.updatedAt);
  validateFeedbackInput(inputOf(value as unknown as FeedbackInput)); validateFeedbackReply(value.reply as string);
  if (!statuses.includes(value.status as FeedbackStatus)) throw new Error('Invalid saved feedback status.');
  if (value.proposal !== undefined) validateProposal(value.proposal);
  if (value.planningState !== undefined && value.planningState !== 'pending' && value.planningState !== 'uncertain') throw new Error('Invalid saved planning state.');
  if (value.planningError !== undefined) validateFeedbackReply(value.planningError as string);
}

/** Browser rehearsal only. Even a configured assistant uses the free guided planner here. */
export class LocalFeedbackLibrary {
  private actor: FeedbackActor;
  constructor(private storage: StoragePort, actor: FeedbackActor = localFeedbackActor) {
    identifier(actor.id);
    if (typeof actor.canReview !== 'boolean' || typeof actor.canConfigure !== 'boolean') throw new Error('Choose valid feedback permissions.');
    this.actor = copy(actor);
  }
  private read(): State {
    try {
      const raw = this.storage.getItem(storageKey);
      if (raw === null) return initial();
      if (new TextEncoder().encode(raw).length > maximumBytes) throw new Error('Oversize storage.');
      const state: unknown = JSON.parse(raw);
      exact(state, ['config', 'items', 'creates', 'receipts', 'deleted']);
      validateFeedbackConfig(state.config as FeedbackConfig);
      if (!Array.isArray(state.items) || !object(state.creates) || !object(state.receipts) || !Array.isArray(state.deleted)) throw new Error('Invalid saved feedback collection.');
      const ids = new Set<string>();
      for (const item of state.items) {
        validateSaved(item); if (ids.has(item.id)) throw new Error('Duplicate saved feedback.'); ids.add(item.id);
      }
      const deleted = new Set<string>();
      for (const id of state.deleted) { identifier(id); if (deleted.has(id) || ids.has(id)) throw new Error('Invalid saved deletion.'); deleted.add(id); }
      for (const [id, created] of Object.entries(state.creates)) {
        identifier(id); exact(created, ['authorId', 'input'], ['duplicateFrom']); identifier(created.authorId); validateFeedbackInput(created.input as FeedbackInput);
        if (created.duplicateFrom !== undefined) { exact(created.duplicateFrom, ['id', 'revision']); identifier(created.duplicateFrom.id); revision(created.duplicateFrom.revision); if (created.duplicateFrom.id === id) throw new Error('Invalid saved duplication receipt.'); }
        const item = state.items.find(value => value.id === id);
        if (!item || item.authorId !== created.authorId) throw new Error('Invalid saved creation receipt.');
      }
      for (const [id, receipts] of Object.entries(state.receipts)) {
        identifier(id); if (!ids.has(id) || !Array.isArray(receipts) || receipts.length > 40) throw new Error('Invalid saved planning receipts.');
        const requests = new Set<string>();
        for (const receipt of receipts) {
          exact(receipt, ['id', 'revision', 'fingerprint', 'proposalId']); identifier(receipt.id); identifier(receipt.proposalId); revision(receipt.revision);
          if (requests.has(receipt.id) || typeof receipt.fingerprint !== 'string' || !fingerprintPattern.test(receipt.fingerprint)) throw new Error('Invalid saved planning request.');
          requests.add(receipt.id);
        }
      }
      if (state.items.some(item => !Object.hasOwn(state.creates as object, item.id) || !Object.hasOwn(state.receipts as object, item.id))) throw new Error('Missing saved feedback receipts.');
      return state as State;
    } catch { throw new Error('This browser’s feedback could not be read. Its saved data has not been changed.'); }
  }
  private write(state: State) {
    const raw = JSON.stringify(state);
    if (new TextEncoder().encode(raw).length > maximumBytes) throw new Error('This browser’s feedback storage is full. Export and delete old requests before adding more.');
    try { this.storage.setItem(storageKey, raw); }
    catch { throw new Error('Feedback could not be saved in this browser. Its saved data has not been changed.'); }
  }
  private reviewer() { if (!this.actor.canReview) throw new Error('A feedback reviewer must perform this action.'); }
  private submitting(state: State) { if (!state.config.submissionEnabled) throw new Error('New feedback is paused by an administrator.'); }
  private item(state: State, id: string, expectedRevision?: number): SavedFeedback {
    identifier(id); const item = state.items.find(value => value.id === id);
    if (!item || !this.actor.canReview && item.authorId !== this.actor.id) throw new Error('This feedback could not be found. Reload your feedback.');
    if (expectedRevision !== undefined) { revision(expectedRevision); if (item.revision !== expectedRevision) throw new Error('This feedback changed in another window. Reload it before continuing.'); }
    return item;
  }
  private async project(item: SavedFeedback): Promise<Feedback> {
    const result: Feedback = { ...inputOf(item), id: item.id, revision: item.revision, status: item.status, reply: item.reply, createdAt: item.createdAt, updatedAt: item.updatedAt, own: item.authorId === this.actor.id };
    if (this.actor.canReview) {
      result.authorId = item.authorId;
      if (item.proposal) result.proposal = { ...copy(item.proposal), stale: item.proposal.sourceFingerprint !== await feedbackFingerprint(inputOf(item)) };
      if (item.planningState) result.planningState = item.planningState;
      if (item.planningError) result.planningError = item.planningError;
    }
    return result;
  }
  private async commit(state: State, item: SavedFeedback): Promise<Feedback> { item.revision += 1; item.updatedAt = stamp(); this.write(state); return this.project(item); }
  async settings(): Promise<FeedbackSettings> {
    const config = copy(this.read().config);
    if (!this.actor.canReview && !this.actor.canConfigure) config.plannerModeId = '';
    return { config, canReview: this.actor.canReview, canConfigure: this.actor.canConfigure, canPlan: this.actor.canReview };
  }
  async saveSettings(config: FeedbackConfig, expectedRevision: number): Promise<FeedbackSettings> {
    if (!this.actor.canConfigure) throw new Error('An administrator must change feedback settings.');
    const clean = validateFeedbackConfig(config), state = this.read(); revision(expectedRevision);
    if (clean.revision !== expectedRevision || state.config.revision !== expectedRevision) throw new Error('Feedback settings changed. Reload settings before saving again.');
    state.config = { ...clean, revision: expectedRevision + 1 }; this.write(state); return this.settings();
  }
  async list(): Promise<Feedback[]> {
    const state = this.read();
    return Promise.all(state.items.filter(item => this.actor.canReview || item.authorId === this.actor.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => this.project(item)));
  }
  async get(id: string): Promise<Feedback> { return this.project(this.item(this.read(), id)); }
  async create(id: string, input: FeedbackInput): Promise<Feedback> {
    identifier(id); const clean = validateFeedbackInput(input), state = this.read();
    if (state.deleted.includes(id)) throw new Error('This feedback was deleted. Send a new request with a new identifier.');
    const existing = state.items.find(item => item.id === id);
    if (existing) {
      const receipt = state.creates[id];
      if (receipt.authorId !== this.actor.id || !sameInput(receipt.input, clean)) throw new Error('This feedback identifier already belongs to another request.');
      return this.project(existing);
    }
    this.submitting(state);
    if (state.items.length >= 200) throw new Error('This browser has reached its feedback limit. Export and delete an old request first.');
    const createdAt = stamp(), item: SavedFeedback = { ...clean, id, revision: 0, status: 'new', reply: '', authorId: this.actor.id, createdAt, updatedAt: createdAt };
    state.items.unshift(item); state.creates[id] = { authorId: this.actor.id, input: copy(clean) }; state.receipts[id] = []; this.write(state); return this.project(item);
  }
  async update(id: string, expectedRevision: number, input: FeedbackInput): Promise<Feedback> {
    const clean = validateFeedbackInput(input), state = this.read(), item = this.item(state, id, expectedRevision);
    if (!this.actor.canReview) {
      this.submitting(state);
      if (!['new', 'reviewing'].includes(item.status)) throw new Error('This request is already being worked on. Send another idea or ask a reviewer to update it.');
    }
    const changed = !sameInput(inputOf(item), clean);
    Object.assign(item, clean);
    if (changed && item.proposal) { item.proposal.stale = true; delete item.proposal.approvedAt; }
    delete item.planningState; delete item.planningError; return this.commit(state, item);
  }
  async review(id: string, expectedRevision: number, status: FeedbackStatus, reply: string): Promise<Feedback> {
    this.reviewer(); if (!statuses.includes(status)) throw new Error('Choose a valid feedback status.');
    const clean = validateFeedbackReply(reply), state = this.read(), item = this.item(state, id, expectedRevision);
    if (item.planningState) throw new Error('Wait for planning to finish or edit this feedback before reviewing.');
    item.status = status; item.reply = clean; return this.commit(state, item);
  }
  async propose(id: string, expectedRevision: number, requestId: string): Promise<Feedback> {
    this.reviewer(); identifier(requestId); revision(expectedRevision);
    let state = this.read(), item = this.item(state, id);
    const previous = state.receipts[id].find(receipt => receipt.id === requestId);
    if (previous) {
      if (previous.revision !== expectedRevision || previous.fingerprint !== await feedbackFingerprint(inputOf(item))) throw new Error('This planning request was already used for a different revision or request.');
      return this.project(item);
    }
    this.item(state, id, expectedRevision);
    if (item.planningState) throw new Error('A planning request is still pending and will not be replayed. Edit this feedback to continue.');
    if (state.receipts[id].length >= 40) throw new Error('This request has reached its planning limit. Duplicate it to start a fresh discussion.');
    const sourceFingerprint = await feedbackFingerprint(inputOf(item)), plan = validateDevelopmentPlan(guidedDevelopmentPlan(inputOf(item)));
    // Hashing yields to the browser. Recheck the revision before committing so a concurrent edit wins.
    state = this.read(); item = this.item(state, id, expectedRevision);
    if (state.receipts[id].some(receipt => receipt.id === requestId)) return this.project(item);
    const proposal: FeedbackProposal = { id: requestId, plan, sourceFingerprint, sourceRevision: expectedRevision, createdAt: stamp(), origin: 'guided', agentName: 'Guided development planner', modelName: 'No model call', contextVersion: 1, stale: false };
    item.proposal = proposal; delete item.planningState; delete item.planningError;
    state.receipts[id].push({ id: requestId, revision: expectedRevision, fingerprint: sourceFingerprint, proposalId: proposal.id });
    return this.commit(state, item);
  }
  async approve(id: string, expectedRevision: number, proposalId: string): Promise<Feedback> {
    this.reviewer(); identifier(proposalId);
    let state = this.read(), item = this.item(state, id, expectedRevision);
    const fingerprint = await feedbackFingerprint(inputOf(item));
    state = this.read(); item = this.item(state, id, expectedRevision);
    if (!item.proposal || item.proposal.id !== proposalId || item.proposal.sourceFingerprint !== fingerprint) throw new Error('Generate and review a current development proposal before approving it.');
    if (item.planningState) throw new Error('Resolve the current planning request before approving this proposal.');
    item.proposal.approvedAt = stamp(); item.proposal.stale = false; return this.commit(state, item);
  }
  async duplicate(id: string, expectedRevision: number, newId: string): Promise<Feedback> {
    this.reviewer(); identifier(id); identifier(newId); revision(expectedRevision); const state = this.read();
    if (state.deleted.includes(newId)) throw new Error('This feedback copy identifier already exists. Reload feedback.');
    const existing = state.items.find(item => item.id === newId);
    if (existing) {
      const receipt = state.creates[newId];
      if (existing.authorId !== this.actor.id || receipt.authorId !== this.actor.id || receipt.duplicateFrom?.id !== id || receipt.duplicateFrom.revision !== expectedRevision) throw new Error('This feedback copy identifier already exists. Reload feedback.');
      return this.project(existing);
    }
    const source = this.item(state, id, expectedRevision); this.submitting(state);
    if (state.items.length >= 200) throw new Error('This browser has reached its feedback limit. Export and delete an old request first.');
    const createdAt = stamp(), input = validateFeedbackInput({ ...inputOf(source), title: copyTitle(source.title) });
    const item: SavedFeedback = { ...input, id: newId, revision: 0, status: 'new', reply: '', createdAt, updatedAt: createdAt, authorId: this.actor.id };
    state.items.unshift(item); state.creates[newId] = { authorId: this.actor.id, input: copy(input), duplicateFrom: { id, revision: expectedRevision } }; state.receipts[newId] = []; this.write(state); return this.project(item);
  }
  async delete(id: string, expectedRevision: number): Promise<void> {
    this.reviewer(); const state = this.read(); this.item(state, id, expectedRevision);
    state.items = state.items.filter(item => item.id !== id); delete state.creates[id]; delete state.receipts[id]; state.deleted.push(id); this.write(state);
  }
}
