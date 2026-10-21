import { useEffect, useRef, useState } from 'react';
import type { Game, GameSettings } from '../lib/game-types';
import { deleteGame, duplicateGame, getGame, getGameSettings, listGames } from '../lib/game-api';
import { GamePlayer } from './GamePlayer';
import { ItemActions } from './ItemActions';
import { useConfirm } from './Confirm';

type Props = { navigate: (path: string) => Promise<void>; adminMode: boolean; signed: boolean };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The Games shelf could not be opened.';
const themeName = { pond: 'A pond adventure', garden: 'A garden adventure', space: 'A space adventure' };
const genreName = { collect: 'Collect treasures', dodge: 'Dodge obstacles', platformer: 'Jumping adventure' };

function useGameActions({ navigate, adminMode, signed }: Props, refresh: () => Promise<void>) {
  const confirm = useConfirm(), lock = useRef(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [settings, setSettings] = useState<GameSettings>();
  useEffect(() => {
    let active = true;
    if (signed) void getGameSettings().then(value => { if (active) setSettings(value); }).catch(() => { if (active) setSettings(undefined); });
    else setSettings(undefined);
    return () => { active = false; };
  }, [signed, adminMode]);
  async function action(kind: 'update' | 'duplicate' | 'delete', value: Game) {
    if (lock.current || !signed || !adminMode || !settings?.canAdminContent) return;
    if (kind === 'update') { await navigate(`/game-studio?game=${encodeURIComponent(value.id)}`); return; }
    if (kind === 'duplicate' && !settings.config.creationEnabled) { setError('Game creation is paused by an administrator.'); return; }
    if (kind === 'delete' && !await confirm(`Permanently delete “${value.spec.title}”? Its draft and public game will both be removed. This cannot be undone.`)) return;
    lock.current = true; setBusy(true); setError('');
    try {
      // The private record is authoritative: a public snapshot may be an older revision.
      const current = await getGame(value.id);
      if (kind === 'duplicate') { const created = await duplicateGame(current); await navigate(`/game-studio?game=${encodeURIComponent(created.id)}`); }
      else { await deleteGame(current); await refresh(); }
    } catch (error) { setError(errorMessage(error)); }
    finally { lock.current = false; setBusy(false); }
  }
  return { busy, error, settings, actions: (game: Game) => signed && adminMode && settings?.canAdminContent ? <ItemActions label={game.spec.title} disabled={busy} onUpdate={() => action('update', game)} onDuplicate={() => action('duplicate', game)} onDelete={() => action('delete', game)} /> : null };
}

export function Games(props: Props) {
  const [games, setGames] = useState<Game[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [filter, setFilter] = useState('all');
  async function refresh() { setLoading(true); try { setGames(await listGames(true)); setError(''); } catch (value) { setError(errorMessage(value)); } finally { setLoading(false); } }
  useEffect(() => { let active = true; void listGames(true).then(value => { if (active) { setGames(value); setError(''); } }).catch(value => { if (active) setError(errorMessage(value)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const controls = useGameActions(props, refresh), shown = games.filter(game => filter === 'all' || game.spec.genre === filter);
  return <main id="main" className="games-page"><section className="games-hero"><div><span className="eyebrow">SMALL CREATURES. BIG ADVENTURES.</span><h1>A whole lotl<br/>of <em>play.</em></h1><p>Little games dreamed up in our newsroom. Collect a treasure, dodge a rock, and see where your curiosity takes you.</p></div><div className="games-hero-art" aria-hidden="true"><span>✦</span><img src="/assets/axolotl-mark.svg" alt="" /><b>PRESS PLAY.<br/>GET CURIOUS.</b></div></section><section className="games-library"><div className="game-section-heading"><div><span className="eyebrow">THE GAMES SHELF</span><h2>Choose your next adventure.</h2></div>{props.signed && <button className="button secondary" onClick={() => void props.navigate('/game-studio')}>Visit the game studio ↗</button>}</div><div className="filter-tabs" role="group" aria-label="Filter games">{[['all', 'All games'], ['collect', 'Collect'], ['dodge', 'Dodge'], ['platformer', 'Jump']].map(([id, title]) => <button key={id} aria-pressed={filter === id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{title}</button>)}</div>{controls.error && <p className="error" role="alert">{controls.error}</p>}{error ? <div className="error" role="alert"><p>{error}</p><button className="button secondary" onClick={() => void refresh()}>Try again</button></div> : loading ? <p role="status">Finding little adventures…</p> : shown.length ? <div className="games-grid">{shown.map(game => <article className="game-card" key={game.id}><a href={`/games/${game.id}`} onClick={event => { event.preventDefault(); void props.navigate(`/games/${game.id}`); }}><div className={`game-card-art world-${game.spec.theme}`}><span className="game-card-star" aria-hidden="true">{game.spec.theme === 'space' ? '✦' : game.spec.theme === 'garden' ? '✿' : '≈'}</span><img src="/assets/axolotl-mark.svg" alt="" style={{ filter: 'none' }} /><span className="game-card-genre">{genreName[game.spec.genre]}</span></div><div className="game-card-copy"><span className="eyebrow">{themeName[game.spec.theme]}</span><h3>{game.spec.title}</h3><p>{game.spec.description}</p><span className="game-card-play">Play the game <span aria-hidden="true">→</span></span></div></a><div className="game-card-actions">{controls.actions(game)}</div></article>)}</div> : <div className="games-empty"><span aria-hidden="true">✦</span><h3>{games.length ? 'A new adventure is just around the corner.' : 'Our first adventures are on their way.'}</h3><p>{games.length ? 'Try another game style to discover something to play.' : 'Games appear here after their creators playtest and publish them. Come back to see what grows!'}</p>{props.signed && <button className="button secondary" onClick={() => void props.navigate('/game-studio')}>Open the game studio →</button>}</div>}</section></main>;
}

export function GamePage(props: Props & { id: string }) {
  const [game, setGame] = useState<Game>(), [loading, setLoading] = useState(true), [error, setError] = useState('');
  async function refresh() { try { setGame(await getGame(props.id, true)); setError(''); } catch (value) { setGame(undefined); setError(errorMessage(value)); } }
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setGame(undefined);
    void getGame(props.id, true).then(value => { if (active) setGame(value); }).catch(value => { if (active) setError(errorMessage(value)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [props.id]);
  const controls = useGameActions(props, refresh);
  return <main id="main" className="game-page"><div className="game-section-heading"><button className="text-button" onClick={() => void props.navigate('/games')}>← Back to Games</button>{game && controls.actions(game)}</div>{controls.error && <p className="error" role="alert">{controls.error}</p>}{loading ? <p role="status">Opening your adventure…</p> : error || !game ? <section className="games-empty"><h1>This adventure isn’t here.</h1><p>{error || 'It may have been unpublished or deleted.'}</p><button className="button primary" onClick={() => void props.navigate('/games')}>Find another game →</button></section> : <><span className="eyebrow">{themeName[game.spec.theme]} · {genreName[game.spec.genre]}</span><h1>{game.spec.title}</h1><p className="game-page-description">{game.spec.description}</p><GamePlayer key={`${game.id}-${game.revision}`} spec={game.spec} /><div className="game-how-to"><span className="eyebrow">HOW TO PLAY</span><p>{game.spec.instructions}</p><span>A little adventure from Axolotl News</span></div></>}</main>;
}
