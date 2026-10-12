import { readFileSync, writeFileSync } from 'node:fs';
const mode = process.env.VITE_APP_MODE;
if (mode === 'nce') {
  // Amplify env config contains public identifiers only; secrets stay in SSM.
  if (process.env.NCE_PUBLIC_CONFIG_JSON) writeFileSync('nce-config.json', process.env.NCE_PUBLIC_CONFIG_JSON);
  const c = JSON.parse(readFileSync('nce-config.json', 'utf8'));
  for (const k of ['issuer', 'api_url']) { const u = new URL(c[k]); if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash || u.username || u.password) throw new Error(`Invalid ${k}: expected HTTPS origin.`); }
  const redirect = new URL(c.redirect_uri);
  if (redirect.protocol !== 'https:' || redirect.pathname !== '/oauth/callback' || redirect.search || redirect.hash) throw new Error('Core redirect must use HTTPS and /oauth/callback.');
  for (const k of ['organization_id', 'service_id', 'browser_client_id']) if (typeof c[k] !== 'string' || !c[k]) throw new Error(`Missing ${k}.`);
  if (JSON.stringify(c).match(/client_secret|password|access_token|refresh_token/i)) throw new Error('Never place secrets in frontend configuration.');
  console.log('Core configuration present. No resources were provisioned.');
} else if (mode === 'cloud') {
  let outputs;
  try { outputs = JSON.parse(readFileSync('amplify_outputs.json', 'utf8')); }
  catch { throw new Error('Missing amplify_outputs.json. Follow the optional standalone deployment guide.'); }
  if (!outputs.auth?.user_pool_id || !outputs.auth?.identity_pool_id || !outputs.data?.url || !outputs.storage?.bucket_name) throw new Error('Incomplete standalone Amplify configuration.');
} else throw new Error('Production builds require VITE_APP_MODE=nce (Core) or cloud (standalone). For a free preview use npm run build:preview.');
