import { useEffect, useRef, useState } from 'react';
import { adminSession } from '../lib/api';
import { authorizeStudioLaunch, getStudioGame, studioPlayerURL, type GameStudioHostConfig, type StudioGame } from '../lib/game-studio-host';

export function StandaloneGameStudio({ config, allowed, navigate }: { config: GameStudioHostConfig; allowed: boolean; navigate: (path: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), inFlight = useRef(false);
  async function open() {
    if (!allowed || inFlight.current) return;
    const request = generation.current;
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      // Top-level Core SSO issues a Game Studio token. No newsroom token crosses origins.
      await authorizeStudioLaunch(config, adminSession, () => request === generation.current, url => location.assign(url));
    } catch (value) { if (request === generation.current) setError(value instanceof Error ? value.message : 'Game Studio could not be opened.'); }
    finally { if (request === generation.current) { inFlight.current = false; setBusy(false); } }
  }
  useEffect(() => {
    generation.current += 1; inFlight.current = false;
    if (allowed) void open();
    return () => { generation.current += 1; inFlight.current = false; };
  }, [allowed, config.origin, config.api_url, config.host_id]);
  return <main id="main" className="game-page"><span className="eyebrow">CONNECTED GAME WORKSHOP</span><h1>Make something worth playing.</h1><p>Game Studio opens in its own workspace. Your shared Core sign-in connects your account; Game Studio checks your administrator access.</p>{allowed ? <><button className="button primary" disabled={busy} onClick={() => void open()}>{busy ? 'Opening Game Studio…' : 'Open Game Studio ↗'}</button><p><button className="text-button" onClick={() => void navigate('/game-studio/legacy')}>Manage existing Axolotl game drafts →</button></p></> : <p>Game creation is available to newsroom administrators.</p>}{error && <p className="error" role="alert">{error}</p>}<button className="text-button" onClick={() => void navigate('/games')}>← Back to Games</button></main>;
}

export function StudioGamePage({ config, id, navigate }: { config: GameStudioHostConfig; id: string; navigate: (path: string) => Promise<void> }) {
  const [game, setGame] = useState<StudioGame>(), [error, setError] = useState('');
  const [frameURL] = useState(() => studioPlayerURL(config, id, true));
  useEffect(() => { let active = true; setGame(undefined); setError(''); void getStudioGame(config, id).then(value => { if (active) setGame(value); }).catch(value => { if (active) setError(value instanceof Error ? value.message : 'This game could not be opened.'); }); return () => { active = false; }; }, [config.origin, config.api_url, id]);
  return <main id="main" className="game-page"><button className="text-button" onClick={() => void navigate('/games')}>← Back to Games</button>{error ? <div className="games-empty"><h1>This adventure isn’t here.</h1><p role="alert">{error}</p></div> : !game ? <p role="status">Opening your adventure…</p> : <><span className="eyebrow">POWERED BY GAME STUDIO</span><h1>{game.title}</h1><p className="game-page-description">{game.description}</p><iframe key={frameURL} src={frameURL} title={`${game.title} — Game Studio player`} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" referrerPolicy="strict-origin" allow={`fullscreen ${new URL(frameURL).origin}`} allowFullScreen style={{ width: '100%', minHeight: 840, border: 0, borderRadius: 16 }} /><p><a className="button secondary" href={studioPlayerURL(config, id)} target="_blank" rel="noopener noreferrer">Open full player and shared high scores ↗</a></p><p className="game-small-note">Game Studio keeps this game’s published edition and score board. Sign in in the full player to submit a shared score.</p></>}</main>;
}
