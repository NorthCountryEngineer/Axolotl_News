import { validateGameSpec } from './game-design';
import type { GameSpec } from './game-types';

export type GameInput = { left?: boolean; right?: boolean; up?: boolean; down?: boolean; jump?: boolean };
export type GameEntity = { id: number; kind: 'snack' | 'hazard'; x: number; y: number; w: number; h: number; vx: number; vy: number };
export type GamePlatform = { x: number; y: number; w: number; h: number };
export type GameState = {
  player: { x: number; y: number; w: number; h: number; vy: number; grounded: boolean };
  entities: GameEntity[];
  platforms: GamePlatform[];
  score: number;
  lives: number;
  elapsed: number;
  invulnerable: number;
  nextSnack: number;
  nextHazard: number;
  seed: number;
  nextId: number;
  previousJump: boolean;
  outcome: 'playing' | 'won' | 'lost';
};

/** Self-contained so the exact tested engine can also run in an opaque-origin iframe. */
export function createGameEngine() {
  const width = 960, height = 540;
  function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function random(state: GameState) { state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0; return state.seed / 4294967296; }
  function spawn(state: GameState, spec: GameSpec, kind: 'snack' | 'hazard') {
    const size = kind === 'snack' ? 22 : 30;
    let x = 35 + random(state) * (width - 70 - size), y = 35 + random(state) * (height - 130 - size), vx = 0, vy = 0;
    if (spec.genre === 'platformer') {
      const platform = state.platforms[1 + Math.floor(random(state) * (state.platforms.length - 1))];
      x = platform.x + 18 + random(state) * (platform.w - 60); y = platform.y - size;
      if (kind === 'hazard') { vx = (random(state) > 0.5 ? 1 : -1) * (20 + spec.rules.difficulty * 8); }
    } else if (spec.genre === 'dodge') {
      y = -size - random(state) * 50;
      vy = kind === 'snack' ? 75 + spec.rules.difficulty * 12 : 85 + spec.rules.difficulty * 28;
    } else if (kind === 'hazard') {
      vx = (random(state) > 0.5 ? 1 : -1) * (25 + spec.rules.difficulty * 10);
      vy = (random(state) > 0.5 ? 1 : -1) * (15 + spec.rules.difficulty * 5);
    }
    // Keep the initial board playable without an unavoidable hit at spawn.
    if (spec.genre === 'collect' && Math.abs(x - state.player.x) < 95 && Math.abs(y - state.player.y) < 95) x = x < width / 2 ? width - 100 : 50;
    state.entities.push({ id: state.nextId++, kind, x, y, w: size, h: size, vx, vy });
  }
  function create(spec: GameSpec): GameState {
    const state: GameState = {
      player: { x: spec.genre === 'platformer' ? 48 : 460, y: spec.genre === 'platformer' ? 464 : spec.genre === 'dodge' ? 448 : 260, w: 42, h: 34, vy: 0, grounded: spec.genre === 'platformer' },
      entities: [], platforms: spec.genre === 'platformer' ? [{ x: 0, y: 500, w: 960, h: 40 }, { x: 40, y: 420, w: 270, h: 16 }, { x: 250, y: 340, w: 270, h: 16 }, { x: 460, y: 260, w: 270, h: 16 }, { x: 650, y: 180, w: 270, h: 16 }, { x: 430, y: 100, w: 270, h: 16 }] : [],
      score: 0, lives: spec.rules.lives, elapsed: 0, invulnerable: 1, nextSnack: 0.4, nextHazard: 0.7, seed: 17031, nextId: 1, previousJump: false, outcome: 'playing',
    };
    if (spec.genre !== 'dodge') {
      for (let i = 0; i < Math.min(7, spec.rules.goal); i++) spawn(state, spec, 'snack');
      for (let i = 0; i < spec.rules.difficulty + 1; i++) spawn(state, spec, 'hazard');
    }
    return state;
  }
  function step(state: GameState, spec: GameSpec, input: GameInput, elapsed: number): GameState {
    if (state.outcome !== 'playing' || !Number.isFinite(elapsed) || elapsed <= 0) return state;
    const dt = Math.min(elapsed, 1 / 20), player = state.player;
    state.elapsed = Math.min(spec.rules.timeLimit, state.elapsed + dt);
    state.invulnerable = Math.max(0, state.invulnerable - dt);
    const speed = 110 + spec.player.speed * 32;
    let dx = Number(Boolean(input.right)) - Number(Boolean(input.left));
    let dy = Number(Boolean(input.down)) - Number(Boolean(input.up));
    if (spec.genre === 'platformer') {
      const jump = Boolean(input.jump || input.up);
      if (jump && !state.previousJump && player.grounded) { player.vy = -(300 + spec.player.jump * 17); player.grounded = false; }
      state.previousJump = jump;
      const oldBottom = player.y + player.h;
      player.x = Math.max(0, Math.min(width - player.w, player.x + dx * speed * dt));
      player.vy += 900 * dt;
      player.y += player.vy * dt;
      player.grounded = false;
      if (player.vy >= 0) for (const platform of state.platforms) {
        if (oldBottom <= platform.y + 0.5 && player.y + player.h >= platform.y && player.x + player.w > platform.x && player.x < platform.x + platform.w) {
          player.y = platform.y - player.h; player.vy = 0; player.grounded = true; break;
        }
      }
      if (player.y > height + 60) { state.lives--; player.x = 48; player.y = 464; player.vy = 0; state.invulnerable = 1.5; }
    } else {
      if (dx && dy) { dx /= Math.SQRT2; dy /= Math.SQRT2; }
      player.x = Math.max(0, Math.min(width - player.w, player.x + dx * speed * dt));
      player.y = Math.max(12, Math.min(height - player.h - 15, player.y + dy * speed * dt));
    }
    if (spec.genre === 'dodge') {
      state.nextSnack -= dt; state.nextHazard -= dt;
      if (state.nextSnack <= 0) { spawn(state, spec, 'snack'); state.nextSnack = Math.min(0.8, spec.rules.timeLimit / (spec.rules.goal * 1.7)); }
      if (state.nextHazard <= 0) { spawn(state, spec, 'hazard'); state.nextHazard = 1.15 - spec.rules.difficulty * 0.13; }
    }
    const collected = new Set<number>();
    for (const entity of state.entities) {
      entity.x += entity.vx * dt; entity.y += entity.vy * dt;
      if (spec.genre === 'collect') {
        if (entity.x <= 12 || entity.x + entity.w >= width - 12) entity.vx *= -1;
        if (entity.y <= 12 || entity.y + entity.h >= height - 35) entity.vy *= -1;
        entity.x = Math.max(12, Math.min(width - entity.w - 12, entity.x)); entity.y = Math.max(12, Math.min(height - entity.h - 35, entity.y));
      } else if (spec.genre === 'platformer' && entity.kind === 'hazard') {
        const surface = state.platforms.find(platform => Math.abs(platform.y - entity.y - entity.h) < 1);
        if (surface && (entity.x <= surface.x + 5 || entity.x + entity.w >= surface.x + surface.w - 5)) entity.vx *= -1;
      }
      if (!overlaps(player, entity)) continue;
      if (entity.kind === 'snack') { collected.add(entity.id); state.score++; }
      else if (!state.invulnerable) {
        state.lives--; state.invulnerable = 1.5;
        if (spec.genre === 'platformer') { player.x = 48; player.y = 464; player.vy = 0; }
      }
    }
    state.entities = state.entities.filter(entity => !collected.has(entity.id) && entity.y < height + 60);
    if (spec.genre !== 'dodge') for (let i = 0; i < collected.size && state.score < spec.rules.goal; i++) spawn(state, spec, 'snack');
    if (state.lives <= 0) { state.lives = 0; state.outcome = 'lost'; }
    else if (state.score >= spec.rules.goal) { state.score = spec.rules.goal; state.outcome = 'won'; }
    else if (state.elapsed >= spec.rules.timeLimit) state.outcome = 'lost';
    return state;
  }
  return { create, step, overlaps, width, height };
}

function startSandbox(engine: ReturnType<typeof createGameEngine>, validate: typeof validateGameSpec, nonce: string) {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const context = canvas.getContext('2d');
  const title = document.getElementById('title')!;
  const instruction = document.getElementById('instruction')!;
  const status = document.getElementById('status')!;
  const announce = document.getElementById('announce')!;
  const start = document.getElementById('start') as HTMLButtonElement;
  const pause = document.getElementById('pause') as HTMLButtonElement;
  let spec: GameSpec | undefined, state: GameState | undefined, running = false, paused = false, notified = false;
  let previous = 0, accumulator = 0;
  const keys = new Set<string>(), pressed = new Set<string>();
  const palette = { pond: ['#e4f2e8', '#b7d9c7', '#38796c', '#fffaf0'], space: ['#211d3e', '#3d355e', '#baaddb', '#f8edff'], garden: ['#f6f1cf', '#c9d8a5', '#6a8547', '#fffdf1'] };
  const input = () => ({ left: keys.has('arrowleft') || keys.has('a') || pressed.has('left'), right: keys.has('arrowright') || keys.has('d') || pressed.has('right'), up: keys.has('arrowup') || keys.has('w') || pressed.has('up'), down: keys.has('arrowdown') || keys.has('s') || pressed.has('down'), jump: keys.has(' ') || pressed.has('jump') });
  function reset() {
    if (!spec) return;
    state = engine.create(spec); running = true; paused = false; notified = false; accumulator = 0; keys.clear(); pressed.clear();
    start.textContent = 'Restart'; pause.textContent = 'Pause'; pause.disabled = false;
    announce.textContent = 'Game started.'; canvas.focus();
  }
  function togglePause() {
    if (!state || !running || state.outcome !== 'playing') return;
    paused = !paused; keys.clear(); pressed.clear(); pause.textContent = paused ? 'Resume' : 'Pause';
    announce.textContent = paused ? 'Paused. Choose Resume to keep playing.' : 'Game resumed.';
    if (!paused) canvas.focus();
  }
  start.addEventListener('click', reset); pause.addEventListener('click', togglePause);
  document.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'a', 'd', 'w', 's', 'p', 'escape', 'r'].includes(key) && event.target !== start && event.target !== pause) {
      event.preventDefault();
      if ((key === 'p' || key === 'escape') && !event.repeat) togglePause();
      else if (key === 'r' && !event.repeat) reset();
      else keys.add(key);
    }
  });
  document.addEventListener('keyup', event => { keys.delete(event.key.toLowerCase()); });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-control]')) {
    const control = button.dataset.control!;
    button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); pressed.add(control); });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, () => { pressed.delete(control); });
    button.addEventListener('keydown', event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); pressed.add(control); } });
    button.addEventListener('keyup', () => { pressed.delete(control); });
    button.addEventListener('blur', () => { pressed.delete(control); });
  }
  window.addEventListener('blur', () => { keys.clear(); pressed.clear(); if (running && !paused && state?.outcome === 'playing') togglePause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && running && !paused && state?.outcome === 'playing') togglePause(); });
  window.addEventListener('message', event => {
    if (event.source !== parent || !event.data || event.data.type !== 'axolotl-game-load' || event.data.nonce !== nonce || spec) return;
    try {
      spec = validate(event.data.spec); state = engine.create(spec);
      title.textContent = spec.title; instruction.textContent = spec.instructions || 'Collect the glowing snacks and avoid the obstacles. Use the arrow keys or WASD, or the touch controls.';
      canvas.setAttribute('aria-label', `${spec.title}. ${spec.genre === 'platformer' ? 'Use arrows or WASD to move and Space or Up to jump.' : 'Use arrows or WASD to move.'} Collect ${spec.rules.goal} ${spec.objects.collectible}s and avoid ${spec.objects.hazard}s.`);
      document.getElementById('legend')!.textContent = `Glowing snack: ${spec.objects.collectible} · Obstacle: ${spec.objects.hazard}`;
      document.getElementById('jump')!.hidden = spec.genre !== 'platformer';
      start.disabled = false; announce.textContent = 'Ready. Choose Start game.';
      parent.postMessage({ type: 'axolotl-game-loaded', nonce }, '*');
    } catch { announce.textContent = 'This game could not be loaded safely.'; }
  });
  function draw() {
    if (!context || !spec || !state) return;
    const ctx = context, colors = palette[spec.theme];
    ctx.fillStyle = colors[0]; ctx.fillRect(0, 0, engine.width, engine.height);
    for (let i = 0; i < 25; i++) {
      ctx.beginPath(); ctx.arc((i * 139 + 31) % 960, (i * 83 + 57) % 520, spec.theme === 'space' ? 2 : 4 + i % 3, 0, Math.PI * 2);
      ctx.fillStyle = colors[1]; ctx.fill();
    }
    if (spec.theme !== 'space') {
      ctx.strokeStyle = colors[2]; ctx.lineWidth = 5; ctx.lineCap = 'round';
      for (let i = 0; i < 12; i++) { const x = i * 89 + 20; ctx.beginPath(); ctx.moveTo(x, 540); ctx.quadraticCurveTo(x - 18, 485, x + 4, 465 - (i % 3) * 15); ctx.stroke(); }
    }
    ctx.fillStyle = colors[2];
    for (const platform of state.platforms) { ctx.fillRect(platform.x, platform.y, platform.w, platform.h); ctx.fillStyle = colors[1]; ctx.fillRect(platform.x, platform.y, platform.w, 5); ctx.fillStyle = colors[2]; }
    for (const entity of state.entities) {
      const x = entity.x + entity.w / 2, y = entity.y + entity.h / 2;
      ctx.beginPath();
      if (entity.kind === 'snack') {
        ctx.fillStyle = '#ecc96b'; ctx.strokeStyle = '#9c702d'; ctx.lineWidth = 2;
        ctx.moveTo(x, y - 12); ctx.lineTo(x + 11, y); ctx.lineTo(x, y + 12); ctx.lineTo(x - 11, y); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff8cf'; ctx.beginPath(); ctx.arc(x - 2, y - 3, 3, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = spec.theme === 'space' ? '#9b82a7' : '#718a84'; ctx.strokeStyle = '#405b55'; ctx.lineWidth = 2;
        ctx.moveTo(x - 14, y + 7); ctx.lineTo(x - 10, y - 9); ctx.lineTo(x + 2, y - 14); ctx.lineTo(x + 14, y - 4); ctx.lineTo(x + 11, y + 13); ctx.lineTo(x - 7, y + 14); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#c5cec3'; ctx.beginPath(); ctx.arc(x - 4, y - 4, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    const p = state.player;
    if (!(state.invulnerable > 0 && Math.floor(state.elapsed * 9) % 2)) {
      const x = p.x + p.w / 2, y = p.y + p.h / 2;
      ctx.save(); ctx.translate(x, y);
      ctx.fillStyle = spec.player.color; ctx.strokeStyle = '#593e55'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(12, 7); ctx.quadraticCurveTo(38, 4, 29, -7); ctx.quadraticCurveTo(21, 3, 10, -5); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#b7658c'; ctx.lineWidth = 3;
      for (const side of [-1, 1]) for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(side * 12, i * 4); ctx.lineTo(side * (23 - Math.abs(i) * 2), i * 10); ctx.stroke(); }
      ctx.fillStyle = spec.player.color; ctx.strokeStyle = '#593e55'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, 16, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#473b46'; ctx.beginPath(); ctx.arc(-6, -2, 2, 0, Math.PI * 2); ctx.arc(6, -2, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(0, 3, 4, 0, Math.PI); ctx.stroke(); ctx.restore();
    }
    if (!running || paused || state.outcome !== 'playing') {
      ctx.fillStyle = spec.theme === 'space' ? '#211d3ed9' : '#fffaf0df'; ctx.fillRect(0, 0, 960, 540);
      ctx.textAlign = 'center'; ctx.fillStyle = spec.theme === 'space' ? '#fffaf0' : '#254e45'; ctx.font = 'bold 42px system-ui';
      ctx.fillText(!running ? 'A little game. A big adventure.' : paused ? 'Taking a little breather.' : state.outcome === 'won' ? 'You did it, little explorer!' : 'Another adventure awaits.', 480, 240);
      ctx.font = '23px system-ui'; ctx.fillText(!running ? 'Choose Start game below.' : paused ? 'Choose Resume to keep playing.' : `Collected ${state.score} of ${spec.rules.goal}. Choose Restart to try again.`, 480, 285);
    }
  }
  function frame(now: number) {
    const dt = previous ? Math.min((now - previous) / 1000, 0.1) : 0; previous = now;
    if (running && !paused && state && spec && state.outcome === 'playing') {
      accumulator += dt;
      while (accumulator >= 1 / 60) { engine.step(state, spec, input(), 1 / 60); accumulator -= 1 / 60; }
    } else accumulator = 0;
    if (state && spec) {
      const seconds = Math.max(0, Math.ceil(spec.rules.timeLimit - state.elapsed));
      const label = `Snacks ${state.score} / ${spec.rules.goal} · Lives ${state.lives} · Time ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      if (status.textContent !== label) status.textContent = label;
      if (state.outcome !== 'playing' && !notified) {
        notified = true; pause.disabled = true;
        announce.textContent = state.outcome === 'won' ? `You won! Collected ${state.score} snacks.` : `Game over. Collected ${state.score} snacks. Choose Restart to try again.`;
        parent.postMessage({ type: 'axolotl-game-result', nonce, result: { outcome: state.outcome, score: state.score, elapsed: state.elapsed } }, '*');
      }
    }
    draw(); requestAnimationFrame(frame);
  }
  if (!context) announce.textContent = 'Your browser cannot display this game canvas.';
  parent.postMessage({ type: 'axolotl-game-ready', nonce }, '*');
  requestAnimationFrame(frame);
}

/** Fixed markup and engine only. User-authored strings arrive later through postMessage. */
export function gameSandboxDocument(nonce: string): string {
  if (!/^[a-zA-Z0-9_-]{16,100}$/u.test(nonce)) throw new Error('A safe random game nonce is required.');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'"><style>
*{box-sizing:border-box}body{margin:0;background:#fffaf0;color:#254e45;font:15px/1.4 system-ui,sans-serif}main{padding:12px}h2{font-size:20px;margin:0 0 6px}p{margin:7px 0}canvas{display:block;width:100%;aspect-ratio:16/9;background:#e4f2e8;border-radius:10px;outline-offset:3px}canvas:focus-visible,button:focus-visible{outline:3px solid #a94c7b}#status{font-weight:700;font-variant-numeric:tabular-nums}.buttons,.touch{display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;margin-top:10px}button{font:inherit;min-height:44px;min-width:56px;padding:8px 15px;border:1px solid #497267;border-radius:8px;background:#fffaf0;color:#254e45;cursor:pointer;touch-action:none;user-select:none}button:active{background:#cce4d5}button:disabled{opacity:.5;cursor:default}#start{background:#254e45;color:#fffaf0}.touch button{font-size:20px;min-width:54px}.touch [hidden]{display:none}#announce{min-height:22px;font-weight:600;text-align:center}#legend{font-size:13px;text-align:center}#instruction{font-size:14px} @media(max-width:500px){main{padding:6px}h2{font-size:18px}.touch{gap:5px}.touch button{padding:7px;min-width:44px}#instruction{font-size:12px}}
</style></head><body><main><h2 id="title">Loading your game…</h2><div id="status" aria-label="Game score"></div><p id="instruction"></p><canvas id="game" width="960" height="540" tabindex="0">This game needs a browser with Canvas support. Keyboard and touch controls are provided.</canvas><p id="legend"></p><div class="buttons"><button id="start" disabled>Start game</button><button id="pause" disabled>Pause</button></div><div class="touch" aria-label="Game movement controls"><button type="button" data-control="left" aria-label="Move left">←</button><button type="button" data-control="up" aria-label="Move up or jump">↑</button><button type="button" data-control="down" aria-label="Move down">↓</button><button type="button" data-control="right" aria-label="Move right">→</button><button type="button" data-control="jump" id="jump" aria-label="Jump">Jump</button></div><p id="announce" role="status" aria-live="polite">Loading…</p><p style="text-align:center;font-size:12px">Arrow keys or WASD · Space to jump · P to pause · R to restart</p></main><script nonce="${nonce}">const __name = (fn) => fn; (${startSandbox.toString()})((${createGameEngine.toString()})(),(${validateGameSpec.toString()}),"${nonce}");</script></body></html>`;
}
