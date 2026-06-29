# DDB Integrator — paid distribution

The module repo is **private**, so the GitHub manifest URL won't install for anyone but you. There are two ways to sell it.

---

## Option A — Sell today: Patreon-gated zip (no infrastructure)

The simplest way to start. No auto-update, but zero setup.

1. Grab the release zip: https://github.com/xtrapklz/ddb-integrator/releases/latest (the `module.zip` asset), or rebuild it any time with `zip -r module.zip module.json scripts/main.js README.md`.
2. Post it as a **patrons-only** download on Patreon.
3. Tell patrons to install it manually:
   > Download `module.zip`, then extract it into your Foundry `Data/modules/` folder so you end up with `Data/modules/ddb-integrator/module.json`. Restart Foundry and enable **DDB Integrator**.

When you ship an update, post the new zip; patrons re-download and replace the folder.

---

## Option B — Auto-updating gated manifest (recommended once you have a few patrons)

A tiny **free Cloudflare Worker** serves the manifest + zip from your private release, but only for a valid per-patron token. Patrons paste one URL into Foundry's *Install Module → Manifest URL* and get updates forever — until you revoke them.

### One-time setup (~15 min)

1. **GitHub token** — create a *fine-grained personal access token* with **read-only "Contents"** on `xtrapklz/ddb-integrator` only. Copy it.
2. **Install Wrangler** and log in:
   ```
   npm install -g wrangler
   wrangler login
   ```
3. From this `distribution/` folder, set the secrets:
   ```
   wrangler secret put GH_TOKEN     # paste the GitHub token
   wrangler secret put TOKENS       # comma-separated patron tokens, e.g.  a1b2c3,d4e5f6
   ```
   (Generate random tokens however you like — `openssl rand -hex 8` is fine.)
4. Deploy:
   ```
   wrangler deploy
   ```
   You'll get a URL like `https://ddb-integrator-gate.<you>.workers.dev`.

### Giving a patron access
Hand them this as the Foundry **Manifest URL** (one per patron):
```
https://ddb-integrator-gate.<you>.workers.dev/<their-token>/module.json
```
Auto-update works because the Worker rewrites the manifest's own URLs to stay tokenized.

### Revoking a patron
Remove their token from `TOKENS` and `wrangler deploy` again. (For many patrons, switch `TOKENS` to a Cloudflare **KV** namespace, or have the Worker check the **Patreon API** for an active membership — easy upgrades later.)

### Publishing an update
Bump `version` in `module.json`, then cut a new GitHub release with the new `module.json` + `module.zip`:
```
gh release create vX.Y.Z ./module.json ./module.zip -t "DDB Integrator vX.Y.Z" -n "..."
```
Every patron's Foundry sees the update automatically — no new URLs to hand out.

---

### Reality check
No Foundry module has real DRM (it's client-side JS). Both options are *soft* protection — they keep honest patrons paying and make casual sharing inconvenient. Option B additionally lets you **revoke** access, which Option A can't.
