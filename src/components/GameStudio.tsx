import { useEffect, useRef, useState } from 'react';
import { createGame, deleteGame, duplicateGame, getGame, getGameSettings, listGames, markGameTested, publishGame, saveGame, saveGameSettings, sendGameMessage, unpublishGame } from '../lib/game-api';
import { defaultGameSpec, validateGameSpec } from '../lib/game-design';
import type { Game, GameConfig, GameSettings, GameSpec } from '../lib/game-types';
import { getAgentSettings } from '../lib/agent-api';
import { isCore } from '../lib/core';
import { useConfirm } from './Confirm';
import { ItemActions } from './ItemActions';
import { GamePlayer } from './GamePlayer';

const examples = ['A pond collecting game. Collect 12 water snacks, 3 lives, 60 seconds.', 'A gentle garden platformer. Collect flowers, 3 lives, 90 seconds.', 'Dodge asteroids in space. Make it a little harder!'];
type Props = { adminMode: boolean; onDirty: (dirty: boolean) => void; navigate: (path: string) => Promise<void>; initialGameId?: string };
type Result = { outcome: 'won' | 'lost'; elapsed: number; score: number };
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Reload and try again.';

export function GameStudio({ adminMode, onDirty, navigate, initialGameId }: Props) {
  const confirm = useConfirm(), busyRef = useRef(false), chatEnd = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useState<GameSettings>(), [config, setConfig] = useState<GameConfig>(), [modes, setModes] = useState<{ id: string; name: string }[]>([]);
  const [games, setGames] = useState<Game[]>([]), [game, setGame] = useState<Game>(), [spec, setSpec] = useState<GameSpec>(() => defaultGameSpec());
  const [idea, setIdea] = useState(''), [message, setMessage] = useState(''), [dirty, setDirty] = useState(false), [settingsDirty, setSettingsDirty] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('Describe a little adventure. We’ll build it together.');
  const [playtest, setPlaytest] = useState(false), [playNumber, setPlayNumber] = useState(0), [result, setResult] = useState<Result>();
  const createRetry = useRef<{ id: string; prompt: string }>(), turnRetry = useRef<{ id: string; gameId: string; revision: number; message: string }>();
  const canEdit = Boolean(settings?.canCreate && settings.config.creationEnabled), creationPaused = settings?.config.creationEnabled === false;
  const configChanged = settingsDirty;

  useEffect(() => { onDirty(dirty || configChanged); }, [dirty, configChanged, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void Promise.all([getGameSettings(), listGames(), initialGameId ? getGame(initialGameId) : Promise.resolve(undefined)]).then(([nextSettings, nextGames, selected]) => {
      if (!active) return;
      setSettings(nextSettings); setConfig(nextSettings.config); setSettingsDirty(false); setGames(nextGames);
      if (selected) load(selected); else { setGame(undefined); setDirty(false); setPlaytest(false); setResult(undefined); }
      if (nextSettings.canManage) void getAgentSettings().then(value => { if (active) setModes(value.config.modes.filter(mode => { const agent = value.config.agents.find(item => item.id === mode.agentId && item.enabled), workflow = value.config.workflows.find(item => item.id === mode.workflowId && item.enabled), model = value.config.models.find(item => item.id === agent?.modelId && item.enabled); return mode.enabled && agent && workflow && model && ['local', 'bedrock'].includes(model.provider) && (!value.availableModeIds || value.availableModeIds.includes(mode.id)); }).map(mode => ({ id: mode.id, name: mode.name }))); }).catch(() => { /* Guided creation does not depend on assistant availability. */ });
    }).catch(value => { if (active) setError(messageOf(value)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [initialGameId]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [game?.messages?.length]);
  useEffect(() => {
    let active = true;
    const check = () => { void getGameSettings().then(value => { if (active) { setSettings(value); if (!settingsDirty) setConfig(value.config); } }).catch(() => { /* The next protected action rechecks server authorization. */ }); };
    window.addEventListener('focus', check); return () => { active = false; window.removeEventListener('focus', check); };
  }, [settingsDirty]);

  function load(value: Game) {
    setGame(value); setSpec(structuredClone(value.spec)); setDirty(false); setPlaytest(false); setResult(undefined); setMessage(''); turnRetry.current = undefined;
    setNotice(value.status === 'Published' ? 'Published version is live. New changes stay private until you test and publish again.' : 'Private draft loaded. Describe a change or fine-tune its details.');
  }
  async function refresh() { setGames(await listGames()); }
  async function run(task: () => Promise<void>) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError('');
    try { await task(); } catch (value) { setError(messageOf(value)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function open(value: Game) {
    if (busyRef.current || dirty && !await confirm('Leave these game changes without saving?')) return;
    await run(async () => { load(await getGame(value.id)); });
  }
  async function newIdea() {
    if (busyRef.current || dirty && !await confirm('Leave these game changes without saving?')) return;
    setGame(undefined); setIdea(''); setDirty(false); setPlaytest(false); setResult(undefined); setError(''); createRetry.current = undefined;
  }
  async function create() {
    if (!canEdit || !idea.trim()) return;
    await run(async () => {
      const text = idea.trim(); if (createRetry.current?.prompt !== text) createRetry.current = { id: crypto.randomUUID(), prompt: text };
      const value = await createGame(createRetry.current.id, text); createRetry.current = undefined; load(value); setIdea(''); await refresh(); setNotice('Your first playable draft is ready. Talk through changes, then save and playtest.');
    });
  }
  function refreshInstructions() { const controls = spec.genre === 'platformer' ? 'Use arrows or WASD to move; Space or Up jumps.' : 'Use arrows or WASD to move.'; change({ ...spec, instructions: `${controls} Collect ${spec.rules.goal} ${spec.objects.collectible}s before time runs out. Avoid ${spec.objects.hazard}s. Touch buttons are available below the game.` }); }
  function change(next: GameSpec) { setSpec(next); setDirty(true); setPlaytest(false); setResult(undefined); setNotice('Unsaved changes. Save this version before playtesting.'); }
  async function save() {
    if (!game || !canEdit) return;
    await run(async () => { const next = await saveGame(game, validateGameSpec(spec)); load(next); await refresh(); setNotice('Changes saved privately. Complete a fresh playtest before publishing.'); });
  }
  async function send() {
    if (!game || !canEdit || !message.trim() || dirty || game.operationState) return;
    await run(async () => {
      const text = message.trim();
      if (!turnRetry.current || turnRetry.current.gameId !== game.id || turnRetry.current.message !== text || turnRetry.current.revision !== game.revision) turnRetry.current = { id: crypto.randomUUID(), gameId: game.id, revision: game.revision, message: text };
      const next = await sendGameMessage(game, turnRetry.current.id, text); turnRetry.current = undefined; load(next); await refresh(); setNotice('Design updated and saved privately. Review the result, then try a fresh playtest.');
    });
  }
  async function duplicate(value: Game) {
    if (!canEdit || dirty) { if (dirty) setError('Save your current changes before duplicating a game.'); return; }
    await run(async () => { load(await duplicateGame(value)); await refresh(); setNotice('A new private copy is ready. Its playtest and publication start fresh.'); });
  }
  async function remove(value: Game) {
    if (!await confirm(`Permanently delete “${value.spec.title}”? Its private draft and published game will be removed. This cannot be undone.`)) return;
    await run(async () => { await deleteGame(value); if (game?.id === value.id) { setGame(undefined); setDirty(false); setPlaytest(false); setResult(undefined); } await refresh(); setNotice('Game deleted.'); });
  }
  async function acknowledge() {
    if (!game || !result || dirty) return;
    await run(async () => { const next = await markGameTested(game); setGame(next); setPlaytest(false); await refresh(); setNotice('Playtest acknowledged for this saved version. You can publish when you are ready.'); });
  }
  async function publish() {
    if (!game || dirty || !canEdit || !settings?.canPublish || game.testedRevision !== game.revision) return;
    if (!await confirm(`Publish “${game.spec.title}” for everyone to play? This shares the saved, tested version of the game.`)) return;
    await run(async () => { load(await publishGame(game)); await refresh(); setNotice('Your game is live in Games! Future edits will stay private until you publish again.'); });
  }
  async function unpublish() {
    if (!game || !await confirm('Remove this game from the public Games section? Its private draft will remain.')) return;
    await run(async () => { load(await unpublishGame(game)); await refresh(); setNotice('Game unpublished. The private draft is still here.'); });
  }
  async function reload() {
    if (dirty && !await confirm('Reload this game and discard unsaved changes?')) return;
    await run(async () => { const currentSettings = await getGameSettings(); setSettings(currentSettings); if (!settingsDirty) setConfig(currentSettings.config); if (game) load(await getGame(game.id)); await refresh(); setNotice('Game library reloaded.'); });
  }
  async function saveConfig() {
    if (!config || !settings?.canManage) return;
    await run(async () => { const next = await saveGameSettings(config, settings.config.revision); setSettings(next); setConfig(next.config); setSettingsDirty(false); setNotice(next.config.creationEnabled ? 'Game creation is enabled.' : 'Game creation is paused. Published games remain playable.'); });
  }
  const live = Boolean(game?.publishedRevision !== undefined), tested = Boolean(game && game.testedRevision === game.revision && !dirty);

  return <main id="main" className="game-studio"><aside className="game-sidebar"><span className="eyebrow">A LITTLE PLAY, A LOT OF POSSIBILITY</span><h1>Game studio<span aria-hidden="true">✦</span></h1><button className="button primary" disabled={busy || loading || !canEdit} onClick={() => void newIdea()}>＋ New game</button><button className="text-button" onClick={() => void navigate('/games')}>Visit the Games shelf ↗</button><div className="game-draft-heading">YOUR GAME DRAFTS <span>{games.length}</span></div><div className="game-draft-list">{games.map(item => <div className="game-draft-row" key={item.id}><button className={`game-draft-item ${game?.id === item.id ? 'active' : ''}`} disabled={busy} onClick={() => void open(item)}><strong>{item.spec.title}</strong><small>{item.publishedRevision !== undefined ? 'Live version + private draft' : 'Private draft'} · {item.spec.genre}</small></button>{adminMode && settings?.canAdminContent && <ItemActions label={item.spec.title} disabled={busy} onUpdate={() => open(item)} onDuplicate={() => duplicate(item)} onDelete={() => remove(item)} />}</div>)}{!loading && !games.length && <p>Your first little adventure belongs here.</p>}</div><div className="game-studio-note"><span aria-hidden="true">✎</span><strong>Make it. Try it. Share it.</strong><p>Every game starts as a private draft. A completed playtest comes before publication.</p></div><button className="text-button" disabled={busy || loading} onClick={() => void reload()}>↻ Reload library</button></aside>
    <section className="game-workbench"><div className="game-workbench-heading"><div><span className="eyebrow">THE LITTLE GAME WORKSHOP</span><h2>{game ? game.spec.title : 'What shall we play?'}</h2></div><span className="game-private-badge">{game ? live ? 'LIVE + PRIVATE WORKSPACE' : 'PRIVATE DRAFT' : 'START WITH AN IDEA'}</span></div>
      <p className="game-status" role="status">{busy ? 'Working on your game…' : notice}</p>{error && <div className="error game-error" role="alert"><p>{error}</p><button className="text-button" disabled={busy} onClick={() => void reload()}>Reload saved game</button></div>}
      {loading ? <p role="status">Opening the game workshop…</p> : <>
        {creationPaused && <div className="game-notice" role="status"><strong>Game creation is taking a little break.</strong><p>An administrator has paused new games, design changes, copies, and publication. Saved games can still be played and playtested.</p></div>}
        {!settings?.canCreate && !creationPaused && <div className="game-notice"><strong>You have a seat in the workshop.</strong><p>Your account can view its available game tools. A newsroom administrator can grant game creation access.</p></div>}
        {!game ? <section className="game-idea-card"><span className="eyebrow">STEP 1 · DREAM UP AN ADVENTURE</span><h3>A pond full of stars?<br/>An axolotl in space?</h3><p>Describe a 2D arcade game. Choose collecting, dodging, or a jumping platform adventure, then talk through the details.</p><label htmlFor="game-idea">Your game idea</label><textarea id="game-idea" value={idea} maxLength={2000} rows={5} disabled={busy || !canEdit} placeholder="A pond collecting game. Collect 12, avoid rocks, 3 lives, 60 seconds…" onChange={event => setIdea(event.target.value)} /><div className="game-example-list" aria-label="Example game ideas">{examples.map(example => <button key={example} disabled={busy || !canEdit} onClick={() => setIdea(example)}>{example}</button>)}</div><button className="button primary" disabled={busy || !canEdit || !idea.trim()} onClick={() => void create()}>Build my first draft →</button><p className="game-small-note">The guided designer creates games from tested building blocks. It supports three game styles and pond, space, or garden worlds. Your idea becomes game settings; no arbitrary game code is generated.</p></section> : <>
          {game.operationState && <div className="game-notice" role="status"><strong>{game.operationState === 'pending' ? 'An assistant request is still pending.' : 'The assistant result could not be confirmed.'}</strong><p>{game.operationError || 'Reload to check its status. You can edit the game details manually or duplicate the draft to continue. A paid request will not be replayed automatically.'}</p></div>}
          <div className="game-builder-grid"><section className="game-conversation"><span className="eyebrow">STEP 2 · MAKE IT YOURS</span><h3>Talk it through.</h3><p className="game-small-note">{settings?.config.assistantModeId ? isCore ? 'Follow-up messages use the administrator’s configured assistant mode and its saved model permissions.' : 'Local preview uses the free guided designer. Configured AI runs only in the connected site.' : 'Free guided designer · try “make it a space game”, “collect 20”, or “60 seconds”.'}</p><div className="game-chat-log" role="log" aria-label="Game design conversation" aria-live="polite">{game.messages?.length ? game.messages.map(item => <div className={`game-chat-message ${item.role}`} key={item.id}><strong>{item.role === 'user' ? 'You' : 'Game designer'}</strong><p>{item.text}</p></div>) : <p>Describe a change to begin a new conversation about this draft.</p>}<div ref={chatEnd} /></div><form onSubmit={event => { event.preventDefault(); void send(); }}><label htmlFor="game-message">What would you like to change?</label><textarea id="game-message" value={message} maxLength={2000} rows={3} disabled={busy || !canEdit || Boolean(game.operationState)} placeholder="Make it gentler, with a pink axolotl and 10 stars…" onChange={event => setMessage(event.target.value)} />{dirty && <p className="game-small-note">Save your changes before sending a design message.</p>}<button className="button primary" disabled={busy || !canEdit || dirty || !message.trim() || Boolean(game.operationState)}>{busy ? 'Designing…' : 'Send to designer →'}</button></form></section>
            <section className="game-details"><span className="eyebrow">OR FINE-TUNE THE DETAILS</span><h3>The little details.</h3><fieldset disabled={busy || !canEdit}><label>Game title<input value={spec.title} maxLength={80} onChange={event => change({ ...spec, title: event.target.value })} /></label><label>Description<textarea value={spec.description} maxLength={300} rows={3} onChange={event => change({ ...spec, description: event.target.value.replace(/[\r\n]/g, ' ') })} /></label><div className="game-field-pair"><label>Game style<select value={spec.genre} onChange={event => change({ ...spec, genre: event.target.value as GameSpec['genre'] })}><option value="collect">Collect treasures</option><option value="dodge">Dodge obstacles</option><option value="platformer">Jumping adventure</option></select></label><label>World<select value={spec.theme} onChange={event => change({ ...spec, theme: event.target.value as GameSpec['theme'] })}><option value="pond">Pond</option><option value="space">Space</option><option value="garden">Garden</option></select></label></div><div className="game-field-pair"><label>Player name<input value={spec.player.name} maxLength={40} onChange={event => change({ ...spec, player: { ...spec.player, name: event.target.value } })} /></label><label>Player color<input type="color" value={spec.player.color} onChange={event => change({ ...spec, player: { ...spec.player, color: event.target.value } })} /></label></div><div className="game-field-pair"><label>Collectible<input value={spec.objects.collectible} maxLength={30} onChange={event => change({ ...spec, objects: { ...spec.objects, collectible: event.target.value } })} /></label><label>Hazard<input value={spec.objects.hazard} maxLength={30} onChange={event => change({ ...spec, objects: { ...spec.objects, hazard: event.target.value } })} /></label></div><div className="game-field-pair"><label>Goal<input type="number" min={3} max={40} value={spec.rules.goal} onChange={event => change({ ...spec, rules: { ...spec.rules, goal: Number(event.target.value) } })} /></label><label>Time limit (seconds)<input type="number" min={30} max={180} value={spec.rules.timeLimit} onChange={event => change({ ...spec, rules: { ...spec.rules, timeLimit: Number(event.target.value) } })} /></label></div><div className="game-field-pair"><label>Lives<input type="number" min={1} max={5} value={spec.rules.lives} onChange={event => change({ ...spec, rules: { ...spec.rules, lives: Number(event.target.value) } })} /></label><label>Difficulty<select value={spec.rules.difficulty} onChange={event => change({ ...spec, rules: { ...spec.rules, difficulty: Number(event.target.value) } })}><option value={1}>Very gentle</option><option value={2}>Gentle</option><option value={3}>A little challenge</option><option value={4}>Tricky</option><option value={5}>Very tricky</option></select></label></div><div className="game-field-pair"><label>Movement speed<input type="number" min={2} max={8} step={1} value={spec.player.speed} onChange={event => change({ ...spec, player: { ...spec.player, speed: Number(event.target.value) } })} /></label><label>Jump strength<input type="number" min={6} max={14} step={1} value={spec.player.jump} onChange={event => change({ ...spec, player: { ...spec.player, jump: Number(event.target.value) } })} /></label></div><label>Instructions<textarea rows={3} maxLength={300} value={spec.instructions} onChange={event => change({ ...spec, instructions: event.target.value.replace(/[\r\n]/g, ' ') })} /></label></fieldset><button className="text-button" disabled={busy || !canEdit} onClick={refreshInstructions}>↻ Refresh instructions from these rules</button><div className="game-detail-actions"><button className="button secondary" disabled={busy || !canEdit || !dirty} onClick={() => void save()}>Save changes</button><span>{dirty ? 'Unsaved changes' : `Saved version ${game.revision + 1}`}</span></div></section></div>
          <section className="game-playtest"><div className="game-section-heading"><div><span className="eyebrow">STEP 3 · TRY YOUR ADVENTURE</span><h3>A private little playtest.</h3></div><button className="button secondary" disabled={busy || dirty} onClick={() => { setPlaytest(true); setResult(undefined); setPlayNumber(number => number + 1); }}>{playtest ? 'Restart playtest' : 'Start playtest'}</button></div><p><strong>Controls:</strong> Arrow keys or WASD to move{game.spec.genre === 'platformer' ? '; Space or Up to jump' : ''}. Touch buttons are available in the game. Try the controls and play to the end of a round. Your test runs in its own isolated game window. Readers keep seeing the last published version.</p>{dirty && <p className="game-notice">Save your changes to playtest this version.</p>}{playtest && !dirty && <GamePlayer key={`${game.id}-${playNumber}`} spec={game.spec} onComplete={setResult} />}{result && playtest && <div className="game-test-result"><strong>{result.outcome === 'won' ? 'Adventure complete!' : 'Round complete. How did it feel?'}</strong><p>Score: {result.score} · {Math.round(result.elapsed)} seconds. Check that the controls, challenge, and wording work as you intended.</p><button className="button secondary" disabled={busy} onClick={() => void acknowledge()}>Mark playtest complete</button></div>}{tested && <p className="game-tested" role="status">✓ You’ve playtested this saved version. It’s ready for a publisher’s review.</p>}</section>
          <section className="game-publish"><div><span className="eyebrow">STEP 4 · OPEN THE DOORS</span><h3>{live ? 'A new edition of your adventure.' : 'Ready for the Games shelf?'}</h3><p>{!settings?.canPublish ? 'A newsroom publisher can publish your tested draft.' : !tested ? 'Save your changes, finish a playtest, and mark it complete to publish.' : 'Publish this saved, tested version for everyone to play.'}</p></div><button className="button primary" disabled={busy || dirty || !tested || !canEdit || !settings?.canPublish} onClick={() => void publish()}>{live ? 'Update published game ↗' : 'Publish game ↗'}</button></section><div className="game-footer-actions">{live && <button className="text-button" onClick={() => void navigate(`/games/${game.id}`)}>View published game ↗</button>}{adminMode && settings?.canAdminContent && live && <button className="text-button danger" disabled={busy} onClick={() => void unpublish()}>Unpublish game</button>}{!live && <button className="text-button danger" disabled={busy} onClick={() => void remove(game)}>Delete private draft</button>}</div>
        </>}
        {settings?.canManage && config && <section className="game-administration"><span className="eyebrow">ADMINISTRATOR SETTINGS</span><h3>Keep the workshop running.</h3><p>Pausing creation stops new games, design changes, copies, and publishing. Published games stay available to play.</p><fieldset disabled={busy}><label className="game-checkbox"><input type="checkbox" checked={config.creationEnabled} onChange={event => { setConfig({ ...config, creationEnabled: event.target.checked }); setSettingsDirty(true); }} />Allow game creation and publication</label><label>Conversation assistant<select value={config.assistantModeId} onChange={event => { setConfig({ ...config, assistantModeId: event.target.value }); setSettingsDirty(true); }}><option value="">Free guided designer</option>{modes.map(mode => <option key={mode.id} value={mode.id}>{mode.name}</option>)}{config.assistantModeId && !modes.some(mode => mode.id === config.assistantModeId) && <option value={config.assistantModeId}>Configured mode: {config.assistantModeId}</option>}</select></label><p className="game-small-note">An optional configured assistant can help refine a game through conversation. Its model, audience, and paid usage permissions come from Agent settings. Every resulting game must still fit the supported 2D game rules.</p></fieldset><button className="button secondary" disabled={busy || !settingsDirty} onClick={() => void saveConfig()}>Save game settings</button>{settingsDirty && <span className="game-settings-unsaved">Unsaved settings</span>}</section>}
      </>}
    </section></main>;
}
