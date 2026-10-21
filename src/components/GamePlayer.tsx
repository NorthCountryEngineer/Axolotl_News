import { useEffect, useMemo, useRef, useState } from 'react';
import { validateGameSpec } from '../lib/game-design';
import { gameSandboxDocument } from '../lib/game-runtime';
import type { GameResult, GameSpec } from '../lib/game-types';

export function GamePlayer({ spec, onComplete }: { spec: GameSpec; onComplete?: (result: GameResult) => void }) {
  const fingerprint = JSON.stringify(spec);
  const instance = useMemo(() => {
    try {
      const validated = validateGameSpec(JSON.parse(fingerprint));
      const nonce = crypto.randomUUID().replaceAll('-', '');
      return { spec: validated, nonce, document: gameSandboxDocument(nonce), error: '' };
    } catch (error) { return { spec: undefined, nonce: '', document: '', error: error instanceof Error ? error.message : 'This game could not be loaded safely.' }; }
  }, [fingerprint]);
  const iframe = useRef<HTMLIFrameElement>(null);
  const completed = useRef(onComplete);
  const [readyNonce, setReadyNonce] = useState('');
  const [failedNonce, setFailedNonce] = useState('');
  useEffect(() => { completed.current = onComplete; }, [onComplete]);
  useEffect(() => {
    if (!instance.spec) return;
    const send = () => iframe.current?.contentWindow?.postMessage({ type: 'axolotl-game-load', nonce: instance.nonce, spec: instance.spec }, '*');
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || !event.data || event.data.nonce !== instance.nonce) return;
      if (event.data.type === 'axolotl-game-ready') { setReadyNonce(instance.nonce); send(); }
      if (event.data.type === 'axolotl-game-loaded') setReadyNonce(instance.nonce);
      if (event.data.type === 'axolotl-game-result') {
        const result = event.data.result;
        if (!result || !['won', 'lost'].includes(result.outcome) || !Number.isFinite(result.elapsed) || result.elapsed < 0 || result.elapsed > instance.spec!.rules.timeLimit || !Number.isInteger(result.score) || result.score < 0 || result.score > instance.spec!.rules.goal) return;
        completed.current?.({ outcome: result.outcome, elapsed: result.elapsed, score: result.score });
      }
    };
    window.addEventListener('message', receive);
    // Covers an iframe that finished loading before React installed the listener.
    send();
    const timeout = window.setTimeout(() => setFailedNonce(instance.nonce), 12000);
    return () => { window.removeEventListener('message', receive); window.clearTimeout(timeout); };
  }, [instance]);
  if (instance.error) return <p role="alert">{instance.error}</p>;
  const ready = readyNonce === instance.nonce;
  return <div className="game-player">
    {!ready && <p role="status">{failedNonce === instance.nonce ? 'The game is taking longer to load. Reload the page to try again.' : 'Preparing your game…'}</p>}
    <iframe key={instance.nonce} ref={iframe} title={`${spec.title} — isolated game player`} srcDoc={instance.document} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'" style={{ display: 'block', width: '100%', height: 'clamp(570px, 70vw, 850px)', border: 0, borderRadius: 12 }} onLoad={() => iframe.current?.contentWindow?.postMessage({ type: 'axolotl-game-load', nonce: instance.nonce, spec: instance.spec }, '*')} />
    <p className="game-player-note">The game runs in an isolated player. Use its Start, Pause, Restart, and touch buttons, or click the game to use your keyboard.</p>
  </div>;
}
