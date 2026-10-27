/** Public host contract. Application credentials never leave their own origin. */
export type GameStudioHostConfig = { origin: string; api_url: string; host_id: 'axolotl-news' };
export type StudioGame = { source: 'studio'; id: string; title: string; description: string; genre: string; publishedRevision: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function origin(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Game Studio requires exact HTTPS origins.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password || value !== url.origin) throw new Error('Game Studio requires exact HTTPS origins.');
  return url.origin;
}
export function parseGameStudioHostConfig(value: unknown): GameStudioHostConfig | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'api_url,host_id,origin') throw new Error('Invalid Game Studio connection configuration.');
  const input = value as Record<string, unknown>;
  if (input.host_id !== 'axolotl-news') throw new Error('The Game Studio host must be axolotl-news.');
  return { origin: origin(input.origin), api_url: origin(input.api_url), host_id: input.host_id };
}
function identifier(value: string) { if (!uuid.test(value)) throw new Error('Invalid Game Studio game identifier.'); return value.toLowerCase(); }
export function studioCreatorURL(config: GameStudioHostConfig): string {
  const valid = parseGameStudioHostConfig(config)!;
  const url = new URL('/game-studio', valid.origin);
  url.searchParams.set('host', valid.host_id); url.searchParams.set('login', 'auto');
  return url.href;
}
export async function authorizeStudioLaunch(config: GameStudioHostConfig, authorize: () => Promise<boolean>, current: () => boolean, navigate: (url: string) => void): Promise<void> {
  if (!current()) return;
  const allowed = await authorize();
  if (!current()) return;
  if (!allowed) throw new Error('Your account no longer has game administrator access.');
  navigate(studioCreatorURL(config));
}
export function studioPlayerURL(config: GameStudioHostConfig, id: string, embedded = false): string {
  const valid = parseGameStudioHostConfig(config)!;
  const url = new URL(`${embedded ? '/embed' : ''}/games/${identifier(id)}`, valid.origin);
  url.searchParams.set('host', valid.host_id);
  if (embedded) url.searchParams.set('channel', crypto.randomUUID());
  return url.href;
}
export function studioGamePath(id: string): string { return `/games/studio/${identifier(id)}`; }
export function legacyStudioPath(id?: string): string { return `/game-studio/legacy${id ? `?game=${identifier(id)}` : ''}`; }
export function parseStudioGameRoute(pathname: string): string | undefined {
  const match = /^\/games\/studio\/([^/]+)$/.exec(pathname);
  return match && uuid.test(match[1]) ? match[1].toLowerCase() : undefined;
}
export function parseStudioGame(value: unknown): StudioGame {
  const game = value as Record<string, unknown>, spec = game?.spec as Record<string, unknown>;
  const text = (value: unknown, maximum: number, empty = false) => typeof value === 'string' && value.length <= maximum && (empty || !!value.trim()) && !/[\u0000-\u001f\u007f<>]/.test(value);
  if (!game || typeof game !== 'object' || Array.isArray(game) || typeof game.id !== 'string' || !uuid.test(game.id) || game.status !== 'Published' || !Number.isSafeInteger(game.publishedRevision) || Number(game.publishedRevision) < 1 || Number(game.publishedRevision) > 1_000_000_000 || game.revision !== game.publishedRevision || !spec || typeof spec !== 'object' || !Number.isSafeInteger(spec.version) || !text(spec.title, 80) || !text(spec.description, 300, true) || !text(spec.genre, 64)) throw new Error('Game Studio returned an invalid published game.');
  // Only metadata enters this host. The standalone player validates all schema versions.
  return { source: 'studio', id: game.id.toLowerCase(), title: spec.title as string, description: spec.description as string, genre: spec.genre as string, publishedRevision: game.publishedRevision as number };
}
export async function listStudioGames(config: GameStudioHostConfig, request: typeof fetch = fetch): Promise<StudioGame[]> {
  const valid = parseGameStudioHostConfig(config)!, games: StudioGame[] = [], ids = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const url = new URL('/games/published', valid.api_url); url.searchParams.set('specVersion', 'all');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await request(url.href, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Game Studio is temporarily unavailable. Your existing Axolotl games are still here.');
    const page = await response.json();
    if (!page || !Array.isArray(page.games) || page.games.length > 100 || page.cursor !== undefined && (typeof page.cursor !== 'string' || !page.cursor || page.cursor.length > 1000)) throw new Error('Game Studio returned an invalid catalog.');
    for (const item of page.games) { const game = parseStudioGame(item); if (ids.has(game.id)) throw new Error('Game Studio returned a repeated game.'); ids.add(game.id); games.push(game); }
    cursor = page.cursor;
    if (cursor && (cursors.has(cursor) || cursors.size >= 100)) throw new Error('Game Studio returned an invalid archive cursor.');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return games;
}
export async function getStudioGame(config: GameStudioHostConfig, id: string): Promise<StudioGame> {
  const valid = parseGameStudioHostConfig(config)!;
  const response = await fetch(new URL(`/games/published/${identifier(id)}`, valid.api_url), { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('This Game Studio adventure is not available. It may have been unpublished.');
  const game = parseStudioGame(await response.json());
  if (game.id !== id.toLowerCase()) throw new Error('Game Studio returned a different game.');
  return game;
}
