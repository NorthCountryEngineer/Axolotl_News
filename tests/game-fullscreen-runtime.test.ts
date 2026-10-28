import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, Script } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GamePlayer } from '../src/components/GamePlayer.tsx';
import { defaultGameSpec } from '../src/lib/game-design.ts';
import { createGameEngine, gameCanvasViewportStyles, gameSandboxDocument, installGameDisplayKeyboardBridge, type GameState } from '../src/lib/game-runtime.ts';
import { gameDisplayMessage } from '../src/lib/game-fullscreen.ts';

const nonce = 'legacy_display_nonce_123456';
type Handler = (event: any) => void;
function key(key: string, changes: Record<string, unknown> = {}) {
  return { key, repeat: false, isComposing: false, keyCode: 0, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, stopped: false, target: {}, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...changes };
}

test('fixed serialized keyboard bridge preserves ordinary typing and admits only explicit display shortcuts', () => {
  let receive!: Handler; const messages: unknown[] = [];
  new Script(`const __name=fn=>fn; (${installGameDisplayKeyboardBridge.toString()})('${nonce}');`).runInNewContext({ document: { addEventListener(name: string, handler: Handler, capture: boolean) { assert.equal(name, 'keydown'); assert.equal(capture, true); receive = handler; } }, parent: { postMessage(value: unknown, target: string) { assert.equal(target, '*'); messages.push(JSON.parse(JSON.stringify(value))); } } });
  for (const changes of [{ target: { isContentEditable: true } }, { target: { closest: () => ({}) } }, { repeat: true }, { isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { defaultPrevented: true }]) receive(key('f', changes));
  for (const name of ['a', 'w', 'r', 'p', 'z', ' ', 'Enter']) receive(key(name));
  assert.equal(messages.length, 0);
  const f = key('F'); receive(f); assert.equal(f.defaultPrevented, true); assert.equal(f.stopped, true);
  receive(key('Enter', { altKey: true, target: { isContentEditable: true } }));
  const escape = key('Escape'); receive(escape); assert.equal(escape.defaultPrevented, false, 'The original game retains its existing Escape pause handling.');
  assert.deepEqual(messages, [{ type: 'game-player-display', nonce, action: 'toggle' }, { type: 'game-player-display', nonce, action: 'toggle' }, { type: 'game-player-display', nonce, action: 'exit' }]);
});

test('actual serialized legacy sandbox retains the same running round, timer and points across display requests', () => {
  const elements = new Map<string, any>(), documentHandlers = new Map<string, { handler: Handler; capture: boolean }[]>(), windowHandlers = new Map<string, Handler[]>(), frames: ((now: number) => void)[] = [], messages: any[] = [];
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { textContent: '', disabled: true, hidden: false, dataset: ['left', 'up', 'down', 'right', 'fire', 'jump'].includes(id) ? { control: id } : {}, handlers: new Map<string, Handler>(), addEventListener(name: string, handler: Handler) { this.handlers.set(name, handler); }, setAttribute() {}, focus() {}, setPointerCapture() {}, getContext: () => new Proxy({}, { get: () => () => {} }) });
    return elements.get(id);
  };
  const engine = createGameEngine(), created: GameState[] = [], source = {} as Window;
  const instrumentedEngine = { ...engine, create(...args: Parameters<typeof engine.create>) { const state = engine.create(...args); state.entities = []; state.nextSnack = state.nextHazard = 999; state.invulnerable = 99; created.push(state); return state; } };
  const parent = { postMessage(value: unknown) { messages.push(JSON.parse(JSON.stringify(value))); } };
  const controls = ['left', 'up', 'down', 'right', 'fire', 'jump'].map(element);
  const html = gameSandboxDocument(nonce), script = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)![1];
  const factory = `(${createGameEngine.toString()})()`;
  assert.equal(script.split(factory).length, 2, 'Only the fixed engine constructor is instrumented to observe reset transitions.');
  const context = createContext({ instrumentedEngine, parent, document: { getElementById: element, querySelectorAll: () => controls, addEventListener(name: string, handler: Handler, capture = false) { const list = documentHandlers.get(name) || []; list.push({ handler, capture }); documentHandlers.set(name, list); } }, window: { addEventListener(name: string, handler: Handler) { const list = windowHandlers.get(name) || []; list.push(handler); windowHandlers.set(name, list); } }, requestAnimationFrame(callback: (now: number) => void) { frames.push(callback); }, deliver(value: unknown) { for (const handler of windowHandlers.get('message') || []) handler({ source: parent, data: value }); } });
  new Script(script.replace(factory, 'instrumentedEngine')).runInContext(context);
  const spec = { ...defaultGameSpec(), genre: 'dodge', theme: 'space', arcade: { rotation: true, shooting: true, splitAsteroids: true, scoring: true, highScores: true } };
  new Script(`deliver(JSON.parse(${JSON.stringify(JSON.stringify({ type: 'axolotl-game-load', nonce, spec }))}));`).runInContext(context);
  element('start').handlers.get('click')({});
  let now = 1000; const tick = (count: number) => { for (let i = 0; i < count; i++) frames.shift()!(now += 1000 / 30); };
  tick(65); const round = created.at(-1)!; round.points = 120;
  const count = created.length, elapsed = round.elapsed, lives = round.lives, readyMessages = messages.filter(value => ['axolotl-game-ready', 'axolotl-game-loaded', 'axolotl-game-result'].includes(value.type)).length;
  assert.ok(elapsed > 1); assert.match(element('status').textContent, /Time/);
  const press = (event: ReturnType<typeof key>) => { for (const { handler } of [...documentHandlers.get('keydown') || []].sort((a, b) => Number(b.capture) - Number(a.capture))) { handler(event); if (event.stopped) break; } };
  press(key('f')); tick(30); press(key('Enter', { altKey: true })); tick(30);
  assert.equal(created.length, count); assert.equal(created.at(-1), round); assert.ok(round.elapsed > elapsed + 1.8); assert.equal(round.points, 120); assert.equal(round.lives, lives);
  assert.equal(messages.filter(value => ['axolotl-game-ready', 'axolotl-game-loaded', 'axolotl-game-result'].includes(value.type)).length, readyMessages, 'Display requests cannot reload, complete or restart the round.');
  const display = messages.filter(value => value.type === 'game-player-display'); assert.equal(display.length, 2);
  for (const data of display) assert.equal(gameDisplayMessage({ origin: 'null', source, data }, source, nonce), 'toggle');
  assert.match(element('status').textContent, /Points 120/);
});

test('legacy player presents fullscreen controls outside the unchanged opaque iframe and fits its HUD', () => {
  const html = renderToStaticMarkup(createElement(GamePlayer, { spec: defaultGameSpec() }));
  assert.match(html, /Full screen/); assert.match(html, /aria-keyshortcuts="F Alt\+Enter Escape"/);
  assert.equal((html.match(/<iframe /g) || []).length, 1); assert.match(html, /sandbox="allow-scripts"/); assert.match(html, /fullscreen &#x27;none&#x27;/);
  assert.doesNotMatch(html, /sandbox="[^"]*allow-same-origin/);
  const sandbox = gameSandboxDocument(nonce); assert.ok(sandbox.includes(gameCanvasViewportStyles)); assert.match(sandbox, /connect-src 'none'/); assert.match(sandbox, /min-height:160px/); assert.match(sandbox, /object-fit:contain/);
  for (const id of ['status', 'campaign', 'start', 'pause', 'next', 'restart', 'controls-help']) assert.ok(sandbox.includes(`id="${id}"`));
});
