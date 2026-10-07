# Moving the real site onto the private gateway

Plain-language checklist for the owner. Nothing here runs by itself; each step is a decision or a command the owner runs or approves. "Preview" means the isolated test copy at `homecall-private-streams-preview`; "production" means the Worker `homecall-metadata` and the GitHub Pages site people actually use.

The one-time switch-over was completed on September 19, 2026 ([#12 cutover record](https://github.com/michaeltorbert/homecall/issues/12#issuecomment-5747055903)). Use **Routine release and rollback** for every later release. The switch-over steps are kept below as history; do not repeat them.

## Routine release and rollback

Production is already provisioned. A routine release never recreates the KV namespace, never generates or re-uploads `MEDIA_TOKEN_KEY`, and never uploads a catalog. The top-level `ENABLE_CATALOG_REFRESH` stays the string `"true"` and the cron stays `17 */6 * * *`; leave both unchanged.

The Pages workflow publishes as soon as a commit lands on `main`; it does not wait for, or check, a Worker deployment. The order of the steps below is a discipline the owner follows, not something the tooling enforces.

1. **Before merging, record the rollback targets.** Run `wrangler deployments list --env ""` for the production Worker version, and note the build the site is serving now (the last green "Test and publish Homecall" run on `main`). After the merge, the served build will already be the new one.
2. **Before merging, check compatibility.** The merged frontend will be served against the Worker that is deployed at that moment, so it must work with that Worker. If the change includes a Worker change, that Worker must also work with the frontend being served when it deploys.
3. **If the frontend needs a newer Worker, split the change into two reviewed releases.** First, release a Worker change that still works with the currently served frontend. Deploy it from `main` and verify it in production. Only after that verification, merge the frontend change that relies on it. The two deployments are separate operations; there is no single atomic deployment.
4. Merge only a reviewed commit to `main`. Do not deploy production from a branch.
5. If the release changes the Worker, deploy it from the merged tree with `npm run worker:deploy` and check the routes listed in historical Step 4, item 2. A documentation-only or frontend-only release has no Worker change and needs no Worker deployment.
6. Confirm the served build matches the merge commit and the Worker version is the one expected (unchanged when there was no Worker change).

Recorded release snapshot, October 7, 2026 (issue #4 release, [PR #23](https://github.com/michaeltorbert/homecall/pull/23), [issue #4 comment](https://github.com/michaeltorbert/homecall/issues/4#issuecomment-6044328539)). Later releases, including documentation-only Pages builds, change what is served, so verify the live targets before acting:

- **Released:** Worker `a7d22be2-19dc-4c10-9097-47fda7716ab6`, Pages `0.4.0+bc6892c` (source `bc6892c`).
- **That release's rollback targets (before #4):** Worker `9b14b839-a291-4b7e-8aa4-18a094108a38`, Pages built from `e82fcc0273c8eb4c17ad855f917ccfbb2457017f`.

To roll back, use **If something goes wrong** below with the targets recorded in step 1. A Worker rollback is not a catalog upload; the **DO NOT UPLOAD** rule applies unchanged.

## If something goes wrong

- Site broken, gateway fine: re-run the Pages workflow from the recorded previous commit.
- Gateway broken: `wrangler rollback <recorded previous version id> --env ""`. At the September 19 switch-over the old Worker did not read the new KV binding, so the site had to go back at the same time. For any release that changed both, roll back both promptly, in either order. These are two separate operations, so expect a short mismatched window between them.
- Bad catalog: set `ENABLE_CATALOG_REFRESH` to `"false"`, deploy, and confirm that the disabled version is the one deployed. Upload the rollback copy only with authoritative evidence that earlier scheduled invocations have completed; a quiet tail, elapsed time or matching digest is not evidence. Without it, **DO NOT UPLOAD**: stop and escalate. Re-enable after the upload. The rollback copy keeps its original check times; never re-stamp them.
- Archive list getting old (the site says it is more than 12 hours old): check that the schedule is deployed and enabled, restore it if needed, and wait for a scheduled run. See PRIVATE-STREAMS.md for the recovery steps. There is no manual refresh command.
- Leaked key suspicion: generate a new key (historical Step 1, item 3) and deploy; every outstanding capability stops working immediately and players reconnect on their own.

## Historical: the September 19 switch-over (completed; do not repeat)

Completed on September 19, 2026. The Worker was deployed and verified first, the scheduled refresh was then enabled, and the site was published as `0.3.0+659fcd4` ([#12 cutover record](https://github.com/michaeltorbert/homecall/issues/12#issuecomment-5747055903)). The rollback targets recorded then (Worker `4e93d47e`, site `da44f8f`) are historical only; rolling back to them now would remove the gateway. The steps below are kept as the record of what was done.

### Before you start (what the pilot assumed)

These were the owner's go-ahead assumptions for a one- or two-listener pilot, not completed acceptance.

- [ ] The preview passed everything in BACKLOG.md under **Private stream rollout** that you care about for launch. Observed by September 19: all seven radio sources, both custom ports, Miami's redirect pool, VT's cold-start redirect, live game streams on desktop (96+ minutes) and iPhone on the preview (playback, lock screen, app switch). The pilot also assumed CPU would fit the Free budget on the native path, based on measured game-stream playlist reloads (p99 8–14 ms, maximum 29 ms, no reported CPU-limit overrun). Cold-start CPU and the Free entitlement were not established then and remain unverified (BACKLOG RELAY-FREE-01). Still not proven: Android, Bluetooth/phone-call interruptions, a whole game on a phone, a provider that uses encryption keys or signed segment URLs.
- [ ] You accept the Free-plan arithmetic: roughly **three people** can listen to game streams at the same time per day before the account's 100,000-request limit is at risk (radio streams are far cheaper, about one request per listening session). If more than that will listen, stop here and decide about a paid plan first; nothing in this checklist changes that number.
- [ ] Codex (or the three-seat review you accepted in its place) has signed off on the final commit of PR #11, and the PR is merged to `main`. Do not deploy production from a branch.

### Step 1 — Create production's private storage (one time)

1. Create a KV namespace for production (name it clearly, e.g. `homecall-stream-catalog-production`). Note its id.
2. Add it to `wrangler.jsonc` under the **top-level** (production) config as `kv_namespaces: [{ "binding": "STREAM_CATALOG", "id": "<that id>" }]`. The preview entry stays as it is. The deploy script refuses to run until this binding exists — that guard is intentional; keep it.
3. Generate a fresh 32-byte key for production (never reuse the preview key):
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
   Store it via stdin only: `wrangler secret put MEDIA_TOKEN_KEY --env ""` and paste when prompted. Never put it in a file that is not ignored, in a command line, or in chat.

### Step 2 — Put the catalog in production storage

1. Make sure `.private/catalog.json` is the version you want live (at the time, `private-2026-09-18-redirect-v3`). Validate it: `node scripts/validate-private-catalog.mjs .private/catalog.json`.
2. Keep a copy: `cp -p .private/catalog.json .private/catalog.production-YYYY-MM-DD.json` (this is your rollback copy).
3. Upload: `wrangler kv key put catalog --path .private/catalog.json --binding STREAM_CATALOG --env "" --remote`.
4. Read it back and check only the version line, not the contents.

### Step 3 — Record what you can roll back to

1. `wrangler deployments list --env ""` — write down the current production Worker version id (on September 19 it was `4e93d47e-…`). Rollback is `wrangler rollback <that id> --env ""`.
2. Note the current GitHub Pages deployment (the last green run of "Test and publish Homecall" on `main`). Rolling the site back means re-running that workflow from the previous commit.

### Step 4 — Deploy the production Worker (gateway only; the site is still the old one)

1. `npm run worker:deploy` (this runs the guard, then deploys the top-level config). At this point in the switch-over `ENABLE_CATALOG_REFRESH` stayed `"false"`; it is now `"true"` and routine deploys leave it so.
2. Check from a browser or curl that these answer correctly on the production Worker's address: `/api/catalog/live` (200, seven ids, gateway URLs only), `/media/live/duke-leanstream` (200 audio), one archive `HEAD` (200), one game entry during a live game (200 master).
3. Look at `wrangler tail --env ""` for a minute of that traffic: no errors, CPU in the same range as preview.

### Step 5 — Turn on the scheduled catalog refresh

1. Set `ENABLE_CATALOG_REFRESH` to `"true"` in the top-level `vars` and deploy again. It is a single configured six-hour schedule. Overlap is not excluded, and KV has no lock. Never upload a catalog by hand unless the conditions in PRIVATE-STREAMS.md, **Recovering an old or stopped catalog**, are met: the disabled version is confirmed deployed and there is authoritative evidence that earlier invocations completed. Without that evidence, **DO NOT UPLOAD**.
2. After the first run, confirm through `/api/catalog/archive` that each refreshed school's `checkedAt` moved, that any failed school is `stale` with its old time, and (by reading back only the version line) that the version string did not change.

### Step 6 — Switch the site over

1. Build the site against the production gateway: set `VITE_GATEWAY_ORIGIN` to the production Worker's origin in the Pages workflow (or the environment it reads), merge, and let the workflow publish.
2. Open the live site on a phone and a desktop: radio plays, a game plays if one is on, an archive plays and seeks. Open the browser's network view once and confirm every media request goes to the gateway, none to a provider host.
3. Tell whoever else uses it.

Phone listening on the production site after this step was not recorded; it remains unverified under BACKLOG DEVICE-01.

## What this checklist does not do

It does not make the Free plan carry more listeners, does not cover Android, and does not remove the old provider addresses from Git history (out of scope by decision).
