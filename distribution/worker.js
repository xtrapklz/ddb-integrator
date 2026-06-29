// DDB Integrator — gated manifest (Cloudflare Worker, free tier)
// --------------------------------------------------------------
// Serves the module manifest + zip from your PRIVATE GitHub release, but ONLY for a valid patron token.
// Patrons install in Foundry with a personal manifest URL:
//     https://<your-worker>.workers.dev/<THEIR-TOKEN>/module.json
//
// Set these as Worker secrets (see DEPLOY.md):
//   GH_TOKEN — a GitHub fine-grained PAT with read-only "Contents" on xtrapklz/ddb-integrator
//   TOKENS   — comma-separated list of valid patron tokens (move to KV when you have many)

const REPO = 'xtrapklz/ddb-integrator';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/([^/]+)\/(module\.json|module\.zip)$/);
    if (!m) return new Response('Not found', { status: 404 });
    const [, token, file] = m;

    // Gate: the token must be on the allow-list. Remove a token (and redeploy) to revoke a patron.
    const allowed = (env.TOKENS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!allowed.includes(token)) return new Response('Invalid or expired token', { status: 403 });

    const asset = await ghReleaseAsset(env.GH_TOKEN, file);
    if (!asset || !asset.ok) return new Response('Release asset unavailable', { status: 502 });

    if (file === 'module.json') {
      // Rewrite manifest/download so Foundry's auto-update keeps checking the gated, tokenized URLs.
      const j = await asset.json();
      const base = `${url.origin}/${token}`;
      j.manifest = `${base}/module.json`;
      j.download = `${base}/module.zip`;
      return new Response(JSON.stringify(j), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(asset.body, { headers: { 'content-type': 'application/zip' } });
  }
};

async function ghReleaseAsset(ghToken, name) {
  const h = { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'ddb-integrator-gate', Accept: 'application/vnd.github+json' };
  const rel = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: h });
  if (!rel.ok) return null;
  const data = await rel.json();
  const a = (data.assets || []).find(x => x.name === name);
  if (!a) return null;
  return fetch(a.url, { headers: { ...h, Accept: 'application/octet-stream' } });
}
