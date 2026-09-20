# Moving the real site onto the private gateway

Plain-language checklist for the owner. Nothing here runs by itself; each step is a decision or a command the owner runs or approves. Do it top to bottom. "Preview" means the isolated test copy at `homecall-private-streams-preview`; "production" means the Worker `homecall-metadata` and the GitHub Pages site people actually use.

## Before you start (what must already be true)

- [ ] The preview passed everything in BACKLOG.md under **Private stream rollout** that you care about for launch. As of September 19: all seven radio sources, both custom ports, Miami's redirect pool, VT's cold-start redirect, live game streams on desktop (96+ minutes) and iPhone (playback, lock screen, app switch), and CPU inside the Free budget on the native path. Still not proven: Android, Bluetooth/phone-call interruptions, a whole game on a phone, a provider that uses encryption keys or signed segment URLs.
- [ ] You accept the Free-plan arithmetic: roughly **three people** can listen to game streams at the same time per day before the account's 100,000-request limit is at risk (radio streams are far cheaper, about one request per listening session). If more than that will listen, stop here and decide about a paid plan first; nothing in this checklist changes that number.
- [ ] Codex (or the three-seat review you accepted in its place) has signed off on the final commit of PR #11, and the PR is merged to `main`. Do not deploy production from a branch.

## Step 1 — Create production's private storage (one time)

1. Create a KV namespace for production (name it clearly, e.g. `homecall-stream-catalog-production`). Note its id.
2. Add it to `wrangler.jsonc` under the **top-level** (production) config as `kv_namespaces: [{ "binding": "STREAM_CATALOG", "id": "<that id>" }]`. The preview entry stays as it is. The deploy script refuses to run until this binding exists — that guard is intentional; keep it.
3. Generate a fresh 32-byte key for production (never reuse the preview key):
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
   Store it via stdin only: `wrangler secret put MEDIA_TOKEN_KEY --env ""` and paste when prompted. Never put it in a file that is not ignored, in a command line, or in chat.

## Step 2 — Put the catalog in production storage

1. Make sure `.private/catalog.json` is the version you want live (currently `private-2026-09-18-redirect-v3`). Validate it: `node scripts/validate-private-catalog.mjs .private/catalog.json`.
2. Keep a copy: `cp -p .private/catalog.json .private/catalog.production-YYYY-MM-DD.json` (this is your rollback copy).
3. Upload: `wrangler kv key put catalog --path .private/catalog.json --binding STREAM_CATALOG --env "" --remote`.
4. Read it back and check only the version line, not the contents.

## Step 3 — Record what you can roll back to

1. `wrangler deployments list --env ""` — write down the current production Worker version id (as of September 19 it is `4e93d47e-…`). Rollback is `wrangler rollback <that id> --env ""`.
2. Note the current GitHub Pages deployment (the last green run of "Test and publish Homecall" on `main`). Rolling the site back means re-running that workflow from the previous commit.

## Step 4 — Deploy the production Worker (gateway only; the site is still the old one)

1. `npm run worker:deploy` (this runs the guard, then deploys the top-level config). `ENABLE_CATALOG_REFRESH` stays `"false"` for now.
2. Check from a browser or curl that these answer correctly on the production Worker's address: `/api/catalog/live` (200, seven ids, gateway URLs only), `/media/live/duke-leanstream` (200 audio), one archive `HEAD` (200), one game entry during a live game (200 master).
3. Look at `wrangler tail --env ""` for a minute of that traffic: no errors, CPU in the same range as preview.

## Step 5 — Turn on the scheduled catalog refresh

1. Set `ENABLE_CATALOG_REFRESH` to `"true"` in the top-level `vars` and deploy again. It runs every six hours and is the **only** writer to the catalog; never upload a catalog by hand while a refresh could be running (pause by setting it back to `"false"` first).
2. After the first run, confirm the archive `checkedAt` moved and the version string did not.

## Step 6 — Switch the site over

1. Build the site against the production gateway: set `VITE_GATEWAY_ORIGIN` to the production Worker's origin in the Pages workflow (or the environment it reads), merge, and let the workflow publish.
2. Open the live site on a phone and a desktop: radio plays, a game plays if one is on, an archive plays and seeks. Open the browser's network view once and confirm every media request goes to the gateway, none to a provider host.
3. Tell whoever else uses it.

## If something goes wrong

- Site broken, gateway fine: re-run the Pages workflow from the previous commit (Step 3, item 2).
- Gateway broken: `wrangler rollback <previous version id> --env ""` (Step 3, item 1). The old Worker does not read the new KV binding, so the site must also go back to its previous build at the same time — do both, in either order, within minutes.
- Bad catalog: set `ENABLE_CATALOG_REFRESH` to `"false"` and deploy, then upload the rollback copy from Step 2, then re-enable.
- Leaked key suspicion: generate a new key (Step 1, item 3) and deploy; every outstanding capability stops working immediately and players reconnect on their own.

## What this checklist does not do

It does not make the Free plan carry more listeners, does not cover Android, and does not remove the old provider addresses from Git history (out of scope by decision).
