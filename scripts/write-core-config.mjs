import { readFileSync, writeFileSync } from 'node:fs';
const [registration, apiUrl] = process.argv.slice(2);
if (!registration || !apiUrl) throw new Error('Usage: node scripts/write-core-config.mjs CORE_PUBLIC_CONFIG.json HTTPS_API_URL');
const p = JSON.parse(readFileSync(registration, 'utf8'));
function origin(value) { const u = new URL(value); if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash || u.username || u.password) throw new Error('Use exact HTTPS origins.'); return u.origin; }
const c = { issuer: origin(p.issuer), organization_id: p.organization_id, service_id: p.service_id, browser_client_id: p.browser_client_id, redirect_uri: p.redirect_uri, api_url: origin(apiUrl) };
if (p.game_studio !== undefined) {
  const g = p.game_studio;
  if (!g || typeof g !== 'object' || Array.isArray(g) || Object.keys(g).sort().join(',') !== 'api_url,host_id,origin' || g.host_id !== 'axolotl-news') throw new Error('Invalid Game Studio public configuration.');
  if (origin(g.origin) !== g.origin || origin(g.api_url) !== g.api_url) throw new Error('Game Studio requires exact HTTPS origins.');
  c.game_studio = { origin: g.origin, api_url: g.api_url, host_id: g.host_id };
}
if (!c.organization_id || !c.service_id || !c.browser_client_id || !c.redirect_uri) throw new Error('Core registration is incomplete.');
writeFileSync('nce-config.json', JSON.stringify(c, null, 2) + '\n');
console.log('Wrote public nce-config.json. Contains no client secret.');
