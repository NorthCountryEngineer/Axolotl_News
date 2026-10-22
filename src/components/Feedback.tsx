import { useEffect, useRef, useState } from 'react';
import { approveFeedbackProposal, createFeedback, deleteFeedback, duplicateFeedback, getFeedback, getFeedbackSettings, listFeedback, proposeFeedback, reviewFeedback, saveFeedbackSettings, updateFeedback } from '../lib/feedback-api';
import { emptyFeedbackInput, exportFeedbackBrief, feedbackAreas, feedbackKinds, feedbackPage, feedbackStatuses, validateFeedbackInput } from '../lib/feedback-model';
import type { Feedback, FeedbackConfig, FeedbackInput, FeedbackSettings, FeedbackStatus } from '../lib/feedback-types';
import { getAgentSettings } from '../lib/agent-api';
import { isCore } from '../lib/core';
import { useConfirm } from './Confirm';
import { ItemActions } from './ItemActions';
import '../feedback.css';

const messageOf = (value: unknown) => value instanceof Error ? value.message : 'Something went wrong. Please try again.';
const pageNames: Record<FeedbackInput['page'], string> = { '/': 'The home page', '/studio': 'The editor’s desk', '/game-studio': 'Game studio', '/games': 'Games', '/posts': 'A story', '/feedback': 'The idea box' };
const inputFrom = (item: Feedback): FeedbackInput => ({ title: item.title, details: item.details, kind: item.kind, area: item.area, page: item.page });
const statusName = (status: FeedbackStatus) => feedbackStatuses.find(item => item.value === status)?.label || status;
const dateName = (date: string) => { const value = new Date(date); return Number.isNaN(value.getTime()) ? '' : value.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const accessFailure = (value: unknown) => Boolean(value && typeof value === 'object' && 'status' in value && [401, 403].includes(Number(value.status))) || /sign.?in|session|not authorized|access denied|permission|forbidden|authentication/iu.test(messageOf(value));

function FeedbackFields({ input, onChange, disabled = false, prefix }: { input: FeedbackInput; onChange: (value: FeedbackInput) => void; disabled?: boolean; prefix: string }) {
  return <fieldset className="feedback-fields" disabled={disabled}>
    <label htmlFor={`${prefix}-title`}>Give your idea a name<input id={`${prefix}-title`} value={input.title} maxLength={120} required placeholder="I wish my axolotl could…" onChange={event => onChange({ ...input, title: event.target.value })} /></label>
    <label htmlFor={`${prefix}-details`}>Tell us more<textarea id={`${prefix}-details`} value={input.details} maxLength={4000} rows={5} required placeholder="What would you like to do? Or what didn’t work how you expected?" onChange={event => onChange({ ...input, details: event.target.value })} /><span className="feedback-field-note">Your own words are perfect. You can include what you tried and what you hoped would happen.</span></label>
    <div className="feedback-field-pair"><label htmlFor={`${prefix}-kind`}>What kind of note?<select id={`${prefix}-kind`} value={input.kind} onChange={event => onChange({ ...input, kind: event.target.value as FeedbackInput['kind'] })}>{feedbackKinds.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label htmlFor={`${prefix}-area`}>What is it about?<select id={`${prefix}-area`} value={input.area} onChange={event => onChange({ ...input, area: event.target.value as FeedbackInput['area'] })}>{feedbackAreas.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
  </fieldset>;
}

export function FeedbackComposer({ page, onClose, onViewFeedback, onSaved }: { page: string; onClose: () => void; onViewFeedback: () => void; onSaved?: (item: Feedback) => void }) {
  const confirm = useConfirm(), dialog = useRef<HTMLDialogElement>(null), alive = useRef(true), busyRef = useRef(false);
  const [input, setInput] = useState(() => emptyFeedbackInput(feedbackPage(page))), [includePage, setIncludePage] = useState(true);
  const [settings, setSettings] = useState<FeedbackSettings>(), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState<Feedback>();
  const initial = useRef(JSON.stringify(input)), retry = useRef<{ id: string; input: string }>(), focused = useRef(false);
  const dirty = !saved && JSON.stringify(input) !== initial.current;
  useEffect(() => {
    alive.current = true; const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal(); dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    void getFeedbackSettings().then(value => { if (alive.current) setSettings(value); }).catch(value => { if (alive.current) setError(messageOf(value)); }).finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; dialog.current?.close(); if (invoker?.isConnected) invoker.focus(); };
  }, []);
  useEffect(() => { if (!loading && settings?.config.submissionEnabled && !focused.current) { focused.current = true; dialog.current?.querySelector<HTMLInputElement>('#feedback-compose-title')?.focus(); } }, [loading, settings?.config.submissionEnabled]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  async function close() { if (busyRef.current) return; if (dirty && !await confirm(retry.current ? 'Close this note? Your send attempt may already have saved it. Check your notes before sending another copy. Any unsent changes will be lost.' : 'Close this note without sending it? Your words will not be saved.')) return; if (alive.current) onClose(); }
  async function submit() {
    if (busyRef.current || !settings?.config.submissionEnabled) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const clean = validateFeedbackInput({ ...input, page: includePage ? feedbackPage(page) : '/' }), fingerprint = JSON.stringify(clean);
      if (retry.current?.input !== fingerprint) retry.current = { id: crypto.randomUUID(), input: fingerprint };
      const value = await createFeedback(retry.current.id, clean);
      if (alive.current) { setSaved(value); retry.current = undefined; onSaved?.(value); }
    } catch (value) { if (alive.current) setError(messageOf(value)); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  return <dialog ref={dialog} className="feedback-composer" aria-labelledby="feedback-composer-title" onCancel={event => { event.preventDefault(); void close(); }}>
    <button className="feedback-close" aria-label="Close idea box" disabled={busy} onClick={() => void close()}>×</button>
    <span className="eyebrow">A LITTLE IDEA CAN START SOMETHING BIG</span><h2 id="feedback-composer-title">{saved ? 'Your note is in!' : 'What would you love to see?'}</h2>
    {saved ? <div className="feedback-thanks"><span aria-hidden="true">✦</span><p>Your newsroom grown-ups can read your note and write back. You can follow its progress in the idea box.</p><strong>{saved.title}</strong><div className="feedback-actions"><button className="button primary" onClick={() => { onClose(); onViewFeedback(); }}>See my notes →</button><button className="text-button" onClick={onClose}>Keep exploring</button></div></div> : <>
      <p>Have a game idea, a wish for the site, or something that needs fixing? Tell us about it.</p>
      {error && <div className="error" role="alert"><p>{error}</p>{retry.current && <p className="feedback-note">If your send response was interrupted, sending the unchanged note again checks the same request. You can also check your notes before starting another copy.</p>}</div>}{loading && <p className="feedback-note" role="status">Opening the idea box…</p>}
      {settings && !settings.config.submissionEnabled && <p className="feedback-notice" role="status">The idea box is taking a little break. Your earlier notes and replies are still available.</p>}
      <form onSubmit={event => { event.preventDefault(); void submit(); }}><FeedbackFields prefix="feedback-compose" input={input} onChange={setInput} disabled={busy || loading || !settings?.config.submissionEnabled} />
        <label className="feedback-checkbox"><input type="checkbox" checked={includePage} disabled={busy} onChange={event => setIncludePage(event.target.checked)} />Tell the grown-ups where I was: {pageNames[feedbackPage(page)]}</label>
        <p className="feedback-note">This note is private to you and the newsroom reviewers. Your draft, pictures, and page content are not attached.</p>
        <div className="feedback-actions"><button className="button primary" disabled={busy || loading || !settings?.config.submissionEnabled || !input.title.trim() || !input.details.trim()}>{busy ? 'Sending your note…' : 'Send my note →'}</button><button type="button" className="text-button" disabled={busy} onClick={() => void close()}>Maybe later</button></div>
      </form>
    </>}
  </dialog>;
}

export function FeedbackWorkspace({ adminMode, onDirty, navigate, refreshToken = 0 }: { adminMode: boolean; onDirty: (value: boolean) => void; navigate: (path: string) => Promise<void>; refreshToken?: number }) {
  const confirm = useConfirm(), alive = useRef(true), busyRef = useRef(false), titleRef = useRef<HTMLInputElement | null>(null), sequence = useRef(0), access = useRef<FeedbackSettings>();
  const [settings, setSettings] = useState<FeedbackSettings>(), [config, setConfig] = useState<FeedbackConfig>(), [modes, setModes] = useState<{ id: string; name: string }[]>([]), [modeError, setModeError] = useState('');
  const [items, setItems] = useState<Feedback[]>([]), [selected, setSelected] = useState<Feedback>(), [input, setInput] = useState(() => emptyFeedbackInput('/feedback'));
  const [reviewStatus, setReviewStatus] = useState<FeedbackStatus>('new'), [reply, setReply] = useState(''), [editing, setEditing] = useState(false), [composer, setComposer] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('Every idea has a place here.'), [filter, setFilter] = useState<'all' | FeedbackStatus>('all');
  const planRetry = useRef<{ itemId: string; revision: number; id: string }>(), duplicateRetry = useRef<{ itemId: string; revision: number; id: string }>();
  const inputDirty = Boolean(selected && editing && JSON.stringify(input) !== JSON.stringify(inputFrom(selected)));
  const reviewDirty = Boolean(selected && settings?.canReview && (reviewStatus !== selected.status || reply !== selected.reply));
  const configDirty = Boolean(config && settings && JSON.stringify(config) !== JSON.stringify(settings.config));
  const dirty = inputDirty || reviewDirty || configDirty;
  const selection = useRef<{ id?: string; dirty: boolean }>({ dirty: false }), lastRefreshToken = useRef(refreshToken);
  selection.current = { id: selected?.id, dirty };
  const canEdit = Boolean(selected && settings && (settings.canReview || selected.own && ['new', 'reviewing'].includes(selected.status) && settings.config.submissionEnabled));
  const canRecoverPlanning = Boolean(selected?.planningState && settings?.canReview);
  const authorizedItems = items.filter(item => settings && (settings.canReview || item.own)), selectedVisible = Boolean(settings && selected && (settings.canReview || selected.own));
  const visible = authorizedItems.filter(item => filter === 'all' || item.status === filter);

  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => { if (lastRefreshToken.current !== refreshToken) { lastRefreshToken.current = refreshToken; refreshListOnly(); } }, [refreshToken]);
  useEffect(() => {
    alive.current = true; const current = ++sequence.current;
    void Promise.all([getFeedbackSettings(), listFeedback()]).then(([next, rows]) => {
      if (!alive.current || current !== sequence.current) return;
      access.current = next; setSettings(next); setConfig(next.config); const safe = visibleItems(rows); setItems(safe);
      if (safe.length) load(safe[0]);
      if (next.canConfigure) loadModes(current);
    }).catch(value => { if (alive.current && current === sequence.current) { clearPrivate(); setError(messageOf(value)); } }).finally(() => { if (alive.current && current === sequence.current) setLoading(false); });
    return () => { alive.current = false; sequence.current++; };
  }, []);
  useEffect(() => {
    const check = () => {
      const current = ++sequence.current;
      void getFeedbackSettings().then(async value => {
        if (!alive.current || current !== sequence.current) return;
        const downgraded = Boolean(access.current?.canReview && !value.canReview), loadPlanner = !access.current?.canConfigure && value.canConfigure;
        access.current = value; setSettings(value); if (!configDirty || !value.canConfigure) setConfig(value.config); if (!value.canConfigure) setModes([]);
        if (downgraded) { clearPrivate(false); setLoading(true); setNotice('Your access changed. Showing only your own notes.'); }
        const rows = await listFeedback();
        if (!alive.current || current !== sequence.current) return;
        const safe = visibleItems(rows); setItems(safe);
        if (downgraded || !selected) { if (safe.length) load(safe[0]); }
        else if (selected && !safe.some(item => item.id === selected.id)) { clearPrivate(false); setItems(safe); if (safe.length) load(safe[0]); }
        setLoading(false); if (loadPlanner) loadModes(current);
      }).catch(value => { if (alive.current && current === sequence.current) { clearPrivate(); setLoading(false); setError(messageOf(value)); } });
    };
    window.addEventListener('focus', check); return () => window.removeEventListener('focus', check);
  }, [configDirty, selected?.id]);

  function loadModes(current: number) {
    void getAgentSettings().then(value => {
      if (!alive.current || current !== sequence.current || !access.current?.canConfigure) return;
      setModeError(''); setModes(value.config.enabled ? value.config.modes.filter(mode => {
        const agent = value.config.agents.find(item => item.id === mode.agentId && item.enabled), workflow = value.config.workflows.find(item => item.id === mode.workflowId && item.enabled), model = value.config.models.find(item => item.id === agent?.modelId && item.enabled);
        return mode.enabled && agent && workflow && model && ['local', 'bedrock'].includes(model.provider) && (!value.availableModeIds || value.availableModeIds.includes(mode.id));
      }).map(mode => ({ id: mode.id, name: mode.name })) : []);
    }).catch(() => { if (alive.current && current === sequence.current) setModeError('Assistant settings could not be loaded. The free guided planner is still available.'); });
  }
  function clearPrivate(clearAccess = true) { setItems([]); setSelected(undefined); setInput(emptyFeedbackInput('/feedback')); setReply(''); setEditing(false); setComposer(false); planRetry.current = undefined; duplicateRetry.current = undefined; if (clearAccess) { access.current = undefined; setSettings(undefined); setConfig(undefined); setModes([]); } }
  function visibleItems(rows: Feedback[]) { return rows.filter(item => access.current?.canReview || item.own).map(item => access.current?.canReview ? item : { ...item, proposal: undefined, planningState: undefined, planningError: undefined, authorId: undefined }); }
  function load(value: Feedback) { setSelected(value); setInput(inputFrom(value)); setReviewStatus(value.status); setReply(value.reply); setEditing(false); planRetry.current = undefined; }
  function apply(value: Feedback, current: number) { if (!alive.current || current !== sequence.current) return; const safe = visibleItems([value])[0]; if (!safe) return; load(safe); setItems(previous => [safe, ...previous.filter(item => item.id !== safe.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); }
  async function run(task: (current: number) => Promise<void>) {
    if (busyRef.current) return; busyRef.current = true; const current = sequence.current; setBusy(true); setError('');
    try { await task(current); } catch (value) { if (alive.current && current === sequence.current) { if (accessFailure(value)) { sequence.current++; clearPrivate(); } setError(messageOf(value)); } } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  async function open(item: Feedback, edit = false) {
    if (busyRef.current || (inputDirty || reviewDirty) && !await confirm('Leave these changes without saving?')) return;
    await run(async current => { const value = await getFeedback(item.id); if (!alive.current || current !== sequence.current) return; const safe = visibleItems([value])[0]; if (!safe) return; load(safe); setEditing(edit); setNotice('Note opened.'); if (edit) requestAnimationFrame(() => titleRef.current?.focus()); });
  }
  async function refresh() {
    if (busyRef.current || dirty && !await confirm('Reload the idea box and discard unsaved changes?')) return;
    await run(async current => {
      const [next, rows, savedItem] = await Promise.all([getFeedbackSettings(), listFeedback(), selected ? getFeedback(selected.id).catch(() => undefined) : Promise.resolve(undefined)]);
      if (!alive.current || current !== sequence.current) return; access.current = next; setSettings(next); setConfig(next.config); const safe = visibleItems(rows); setItems(safe); const saved = savedItem && visibleItems([savedItem])[0]; if (saved) load(saved); else if (safe.length) load(safe[0]); else { setSelected(undefined); setInput(emptyFeedbackInput('/feedback')); setReply(''); setEditing(false); } if (next.canConfigure) loadModes(current); setNotice('The idea box is up to date.');
    });
  }
  function refreshListOnly() {
    const current = sequence.current;
    void listFeedback().then(rows => { if (alive.current && current === sequence.current) { const safe = visibleItems(rows); setItems(safe); if (!selection.current.id && !selection.current.dirty && safe.length) load(safe[0]); } }).catch(value => { if (alive.current && current === sequence.current) { if (accessFailure(value)) { sequence.current++; clearPrivate(); } setError(messageOf(value)); } });
  }
  async function saveInput() {
    if (!selected || !canEdit || busyRef.current) return;
    if (reviewDirty) { setError('Save your progress and reply before saving changes to the note.'); return; }
    const recovering = Boolean(selected.planningState && settings?.canReview);
    if (recovering && !await confirm('Clear this unfinished planning request and save the note? The earlier model call may already have run or incurred a charge, even when its result is unknown. Saving does not call a model. A later new proposal is a separate request and may incur another configured model charge.')) return;
    await run(async current => { const value = await updateFeedback(selected, validateFeedbackInput(input)); apply(value, current); if (alive.current && current === sequence.current) setNotice(recovering ? 'The unfinished planning request is cleared. Your note is saved. Request a new proposal explicitly when you are ready.' : 'Your changes are saved. Any earlier development proposal needs a fresh review.'); });
  }
  async function saveReview() { if (!selected || !settings?.canReview || inputDirty) return; await run(async current => { const value = await reviewFeedback(selected, reviewStatus, reply.trim()); apply(value, current); if (alive.current && current === sequence.current) setNotice('Progress and reply saved. The author can see your update.'); }); }
  async function duplicate(item: Feedback) {
    if (!settings?.canReview || dirty) { if (dirty) setError('Save your changes before making a copy.'); return; }
    await run(async current => { if (!duplicateRetry.current || duplicateRetry.current.itemId !== item.id || duplicateRetry.current.revision !== item.revision) duplicateRetry.current = { itemId: item.id, revision: item.revision, id: crypto.randomUUID() }; const value = await duplicateFeedback(item, duplicateRetry.current.id); duplicateRetry.current = undefined; apply(value, current); if (alive.current && current === sequence.current) setNotice('A new note is ready. Its review and development proposal start fresh.'); });
  }
  async function remove(item: Feedback) {
    if (!settings?.canReview || busyRef.current || !await confirm(`Permanently delete “${item.title}”? Its feedback, reply, and development proposal will be removed. This cannot be undone.`)) return;
    await run(async current => { await deleteFeedback(item); const rows = await listFeedback(); if (!alive.current || current !== sequence.current) return; const safe = visibleItems(rows); setItems(safe); if (selected?.id === item.id) { if (safe.length) load(safe[0]); else { setSelected(undefined); setInput(emptyFeedbackInput('/feedback')); setReply(''); setEditing(false); } } setNotice('Note deleted.'); });
  }
  async function propose() {
    if (!selected || !settings?.canPlan || dirty || selected.planningState) return;
    await run(async current => {
      if (!planRetry.current || planRetry.current.itemId !== selected.id || planRetry.current.revision !== selected.revision) planRetry.current = { itemId: selected.id, revision: selected.revision, id: crypto.randomUUID() };
      const value = await proposeFeedback(selected, planRetry.current.id); apply(value, current); if (alive.current && current === sequence.current) setNotice(value.planningState ? 'Check the saved request status before planning again.' : 'Development approach proposed. Review it before approving a handoff.');
    });
  }
  async function approve() {
    if (!selected?.proposal || selected.proposal.stale || !settings?.canReview || dirty || selected.planningState || !await confirm('Approve this development approach as a handoff? It can then be copied or downloaded. This does not change the site or run a deployment.')) return;
    await run(async current => { apply(await approveFeedbackProposal(selected), current); if (alive.current && current === sequence.current) setNotice('Development approach approved. You can copy or download the handoff when ready.'); });
  }
  async function exportBrief(download: boolean) {
    if (!selected || !settings?.canReview || dirty) return;
    await run(async current => {
      const [nextSettings, saved] = await Promise.all([getFeedbackSettings(), getFeedback(selected.id)]);
      if (!alive.current || current !== sequence.current) return;
      if (!nextSettings.canReview) { sequence.current++; clearPrivate(false); access.current = nextSettings; setSettings(nextSettings); setConfig(nextSettings.config); setError('Your access changed. Reload to see your own notes.'); return; }
      access.current = nextSettings; setSettings(nextSettings); setConfig(nextSettings.config); apply(saved, current);
      if (saved.revision !== selected.revision || saved.planningState) throw new Error('This note changed. Review its saved proposal and approval before exporting.');
      const text = exportFeedbackBrief(saved);
      if (download) {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })), anchor = document.createElement('a');
        anchor.href = url; anchor.download = `axolotl-feedback-${selected.id}.md`; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice('Approved development handoff downloaded.');
      } else { await navigator.clipboard.writeText(text); if (alive.current && current === sequence.current) setNotice('Approved development handoff copied.'); }
    });
  }
  async function saveConfig() { if (!config || !settings?.canConfigure) return; await run(async current => { const value = await saveFeedbackSettings(config, settings.config.revision); if (!alive.current || current !== sequence.current) return; access.current = value; setSettings(value); setConfig(value.config); setNotice('Idea box settings saved.'); }); }
  const proposal = selected?.proposal, plan = proposal?.plan, approved = Boolean(proposal?.approvedAt && !proposal.stale && !selected?.planningState);

  return <main id="main" className="feedback-workspace">
    <aside className="feedback-sidebar"><span className="eyebrow">SMALL WISHES. BIG POSSIBILITIES.</span><h1>The idea box<span aria-hidden="true">✦</span></h1><p>{settings?.canReview ? 'Listen to the newsroom. Turn good ideas into the next little adventure.' : 'Your wishes, discoveries, and things you would like us to fix.'}</p><button className="button primary" disabled={loading || busy || !settings?.config.submissionEnabled} onClick={() => setComposer(true)}>＋ Share an idea</button><button className="text-button" disabled={busy} onClick={() => void navigate('/studio')}>Back to the editor’s desk ↗</button>
      <div className="feedback-list-heading"><strong>{settings?.canReview ? 'NEWSROOM INBOX' : 'YOUR NOTES'}</strong><span>{authorizedItems.length}</span></div>
      <label className="feedback-filter">Show<select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">All notes</option>{feedbackStatuses.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <div className="feedback-list">{visible.map(item => <div className={`feedback-list-row ${selected?.id === item.id ? 'active' : ''}`} key={item.id}><button className="feedback-list-item" disabled={busy} onClick={() => void open(item)}><strong>{item.title}</strong><span className={`feedback-status feedback-status-${item.status}`}>{statusName(item.status)}</span><small>{dateName(item.updatedAt)}{settings?.canReview && item.own ? ' · Yours' : ''}</small></button>{adminMode && settings?.canReview && <ItemActions label={item.title} disabled={busy} onUpdate={() => open(item, true)} onDuplicate={() => duplicate(item)} onDelete={() => remove(item)} />}</div>)}{!loading && !visible.length && <p className="feedback-list-empty">{authorizedItems.length ? 'No notes at this stage yet.' : 'A good idea belongs here. What would you love to make possible?'}</p>}</div>
      <button className="text-button" disabled={loading || busy} onClick={() => void refresh()}>↻ Reload idea box</button>
    </aside>
    <section className="feedback-workbench"><header className="feedback-heading"><div><span className="eyebrow">{settings?.canReview ? 'LISTEN. THINK. BUILD.' : 'YOUR LITTLE WISH LIST'}</span><h2>{selectedVisible ? selected?.title : 'What shall we make possible?'}</h2></div><span className="feedback-private-badge">PRIVATE IDEA BOX</span></header><p className="feedback-workspace-status" role="status">{busy ? 'Working on your note…' : notice}</p>
      {error && <div className="error feedback-error" role="alert"><p>{error}</p><button className="text-button" disabled={busy} onClick={() => void refresh()}>Reload saved notes and permissions</button></div>}
      {loading ? <p role="status">Opening the idea box…</p> : <>
        {settings && !settings.config.submissionEnabled && <p className="feedback-notice" role="status">New notes are paused. You can still read your earlier notes and replies.</p>}
        {!selected || !selectedVisible ? <div className="feedback-empty"><span aria-hidden="true">✎</span><h3>Every new thing starts<br/>with “What if?”</h3><p>Tell the newsroom what you would like to see, what you love using, or what could work better.</p><button className="button primary" disabled={busy || !settings?.config.submissionEnabled} onClick={() => setComposer(true)}>Share my first idea →</button></div> : <>
          <article className="feedback-note-card"><div className="feedback-note-heading"><span className={`feedback-status feedback-status-${selected.status}`}>{statusName(selected.status)}</span><span>{feedbackKinds.find(item => item.value === selected.kind)?.label} · {feedbackAreas.find(item => item.value === selected.area)?.label}</span><time dateTime={selected.createdAt}>{dateName(selected.createdAt)}</time></div>
            {editing ? <form onSubmit={event => { event.preventDefault(); void saveInput(); }}><div ref={element => { if (element) titleRef.current = element.querySelector('input'); }}><FeedbackFields prefix="feedback-edit" input={input} onChange={setInput} disabled={busy || !canEdit || reviewDirty} /></div>{reviewDirty && <p className="feedback-note">Save your progress and reply below before editing this note.</p>}{canRecoverPlanning && <p className="feedback-note">You can save the same note to clear the unfinished planning request. Saving does not run a model; a later new proposal may incur another configured model charge.</p>}<div className="feedback-actions"><button className="button primary" disabled={busy || !canEdit || reviewDirty || !inputDirty && !canRecoverPlanning}>{canRecoverPlanning ? 'Save note and clear unfinished request' : 'Save changes'}</button><button className="text-button" type="button" disabled={busy} onClick={async () => { if (inputDirty && !await confirm('Discard these changes to the note?')) return; setInput(inputFrom(selected)); setEditing(false); }}>Cancel editing</button></div></form> : <><h3>{selected.title}</h3><p className="feedback-prose">{selected.details}</p><p className="feedback-note">From: {pageNames[selected.page]}</p>{canEdit && <button className="text-button" disabled={busy || reviewDirty} onClick={() => { setEditing(true); requestAnimationFrame(() => titleRef.current?.focus()); }}>✎ Edit this note</button>}{reviewDirty && <p className="feedback-note">Save your progress and reply before editing this note.</p>}</>}
          </article>
          {!settings?.canReview && <section className="feedback-parent-reply" aria-labelledby="feedback-reply-heading"><span className="eyebrow">A NOTE BACK TO YOU</span><h3 id="feedback-reply-heading">{selected.reply ? 'The newsroom says…' : 'We have your idea.'}</h3><p className="feedback-prose">{selected.reply || 'Your note is waiting for a grown-up to take a look. Any reply and progress update will appear right here.'}</p></section>}
          {settings?.canReview && <>
            <section className="feedback-review" aria-labelledby="feedback-review-heading"><span className="eyebrow">KEEP THE CONVERSATION GOING</span><h3 id="feedback-review-heading">A little update goes a long way.</h3><p className="feedback-note">The author can see this progress and your reply. Development plans below stay with reviewers.</p><form onSubmit={event => { event.preventDefault(); void saveReview(); }}><fieldset disabled={busy || inputDirty}><label>Progress<select value={reviewStatus} onChange={event => setReviewStatus(event.target.value as FeedbackStatus)}>{feedbackStatuses.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Your reply<textarea rows={4} maxLength={2000} value={reply} placeholder="I love this idea! Here is what we can try next…" onChange={event => setReply(event.target.value)} /></label></fieldset><div className="feedback-actions"><button className="button secondary" disabled={busy || !reviewDirty || inputDirty}>Save progress and reply</button>{inputDirty && <span className="feedback-note">Save the edited note first.</span>}</div></form></section>
            <section className="feedback-planning" aria-labelledby="feedback-planning-heading"><div className="feedback-planning-heading"><div><span className="eyebrow">REVIEWER WORKSHOP · PRIVATE</span><h3 id="feedback-planning-heading">From an idea to a buildable plan.</h3></div><span aria-hidden="true">✦</span></div><p className="feedback-note">Ask for a development approach, review the suggested work, then approve a handoff. This never edits code, opens a GitHub issue, or deploys the site.</p>
              <p className="feedback-planner-source">{settings.config.plannerModeId ? isCore ? 'Uses the configured assistant and its saved model permissions when you request a proposal.' : 'Local preview uses the free guided planner. The selected AI assistant runs only on the connected site.' : 'Free guided planner · suggests a structured starting point without calling an AI model.'}</p>
              {selected.planningState && <div className="feedback-notice" role="status"><strong>{selected.planningState === 'pending' ? 'A planning request is still pending.' : 'This planning result could not be confirmed.'}</strong><p>{selected.planningError || 'Reload this note to check the saved result. A model request is never repeated automatically.'}</p><p>If it stays unresolved, clear the unfinished request without changing your note. The earlier model call may already have run or incurred a charge. Clearing does not run a model; a later new proposal may incur another configured model charge.</p><div className="feedback-actions"><button className="text-button" disabled={busy || dirty} onClick={() => void refresh()}>Check saved result</button><button className="button secondary" disabled={busy || dirty || !canRecoverPlanning} onClick={() => void saveInput()}>Clear unfinished request</button></div></div>}
              <button className="button primary" disabled={busy || dirty || !settings.canPlan || Boolean(selected.planningState)} onClick={() => void propose()}>{planRetry.current?.itemId === selected.id ? 'Check or retry the same request' : proposal ? 'Propose a fresh development approach' : '✦ Propose development approach'}</button>{dirty && <p className="feedback-note">Save your changes before requesting or approving a proposal.</p>}
              {proposal && plan && <div className="feedback-development-plan"><div className="feedback-plan-meta"><span>{proposal.origin === 'agent' ? 'AI-assisted proposal' : 'Guided proposal'}</span><span>{proposal.origin === 'agent' ? `${proposal.agentName} · ${proposal.modelName}` : 'Free structured planner'}</span><span>Based on note version {proposal.sourceRevision + 1}</span><span>{dateName(proposal.createdAt)}</span></div>
                {proposal.stale && <p className="feedback-notice" role="status"><strong>This proposal is out of date.</strong> The source note has changed. Request and review a fresh proposal before approving or exporting it.</p>}
                <h4>{plan.summary}</h4><p className="feedback-prose">{plan.approach}</p><span className="feedback-effort">Estimated scope: {plan.effort}</span>
                <h5>Suggested implementation</h5><ol className="feedback-plan-steps">{plan.steps.map((step, index) => <li key={index}><strong>{step.title}</strong><p className="feedback-prose">{step.details}</p>{step.files.length > 0 && <div className="feedback-file-list"><span>Suggested files to inspect:</span>{step.files.map((file, fileIndex) => <code key={fileIndex}>{file}</code>)}</div>}</li>)}</ol>
                <PlanList title="How we know it works" items={plan.acceptanceCriteria} /><PlanList title="Tests to run" items={plan.tests} /><PlanList title="Risks and tradeoffs" items={plan.risks} /><PlanList title="Questions before building" items={plan.questions} />
                <div className="feedback-plan-approval">{approved ? <><p><strong>✓ Approved for handoff</strong> · {dateName(proposal.approvedAt!)}</p><div className="feedback-actions"><button className="button secondary" disabled={busy || dirty} onClick={() => void exportBrief(true)}>Download development brief</button><button className="text-button" disabled={busy || dirty} onClick={() => void exportBrief(false)}>Copy brief</button></div></> : <><p>Check the scope, suggested files, open questions, and tests. Approval records your review; you decide when to start building.</p><button className="button secondary" disabled={busy || dirty || proposal.stale || Boolean(selected.planningState)} onClick={() => void approve()}>Approve development approach</button></>}</div>
              </div>}
            </section>
          </>}
        </>}
        {settings?.canConfigure && config && <section className="feedback-administration" aria-labelledby="feedback-settings-heading"><span className="eyebrow">NEWSROOM SETTINGS</span><h3 id="feedback-settings-heading">Keep the idea box open.</h3><fieldset disabled={busy}><label className="feedback-checkbox"><input type="checkbox" checked={config.submissionEnabled} onChange={event => setConfig({ ...config, submissionEnabled: event.target.checked })} />Let signed-in users send new notes</label><label>Development planner<select value={config.plannerModeId} onChange={event => setConfig({ ...config, plannerModeId: event.target.value })}><option value="">Free guided planner</option>{config.plannerModeId && !modes.some(mode => mode.id === config.plannerModeId) && <option value={config.plannerModeId}>Saved assistant · currently unavailable</option>}{modes.map(mode => <option value={mode.id} key={mode.id}>{mode.name}</option>)}</select></label></fieldset><p className="feedback-note">Choose an enabled writing assistant from Agent settings. Planning uses its agent instructions, selected model, audience, and saved execution permissions. It does not run a media workflow. No model is called when a note is sent or opened.</p>{modeError && <p className="feedback-note">{modeError}</p>}<div className="feedback-actions"><button className="button secondary" disabled={busy || !configDirty} onClick={() => void saveConfig()}>Save idea box settings</button>{configDirty && <span className="feedback-note">Unsaved settings</span>}</div></section>}
      </>}
    </section>
    {composer && <FeedbackComposer page="/feedback" onClose={() => { setComposer(false); refreshListOnly(); }} onViewFeedback={() => { setComposer(false); void refresh(); }} />}
  </main>;
}

function PlanList({ title, items }: { title: string; items: string[] }) { return items.length ? <div className="feedback-plan-list"><h5>{title}</h5><ul>{items.map((item, index) => <li className="feedback-prose" key={index}>{item}</li>)}</ul></div> : null; }
