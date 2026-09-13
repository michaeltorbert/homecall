# Homecall

A small manual-sync internet audio player for Duke, Miami and Virginia Tech. Open the site, choose your team, and delay the call to match your TV. No account, microphone, camera or recognition model is required.

## Listen and align

1. Choose a team and press **Play**. Keep the page in the foreground for this first version.
2. If the call arrives before the TV picture, use **Match a play**: tap when you hear a distinctive play, then tap again when you see it. Audio pauses between taps while the incoming history keeps filling.
3. Fine-tune with **±5 s, ±1 s or ±¼ s**, or the delay slider. Press **Sounds aligned** to mark the result in your log.
4. Check alignment after commercials or interruptions. If the call is late even at zero delay, pause your TV until it catches up. This app cannot play audio from the future.

Pause keeps collecting audio for up to three minutes. A buffer overrun cancels a pending match and leaves audio paused. Canceling a match restores the delay from before the first tap relative to the current incoming edge; it skips the abandoned hold. Reconnecting or switching teams discards the previous buffer. If a user timing command cannot be acknowledged, the app disconnects rather than allowing that queued change to apply unexpectedly later; reconnect when ready. The displayed delay is what this app adds, **not total stadium-to-listener latency**.

## Send a test log from a phone

Open **Share a test log**, preview it, then tap **Share test log** and choose Mail or Messages. If the browser lacks a share menu, **Copy** the complete log and paste it into an email, or **Download** the JSON attachment. Nothing is sent automatically and no recipient is hardcoded. Refresh the preview to include newer adjustments.

Logs contain team/source identifiers, times, requested and applied adjustments, interruptions and your alignment marks. Optional TV-service and output categories are selected before starting. They contain no recorded audio, camera images, email address, device fingerprint, source URLs or raw error text. The broadcaster and site host still receive ordinary network requests. Up to 10 sessions and 2,000 events per session are retained locally; truncation is disclosed. If local storage is blocked/full, export before closing the page. Unclosed logs after a reload are labeled last-saved snapshots.

Several nudges before another alignment mark form one confirmed adjustment episode. Neither those episodes nor observed playback intervals prove actual TV drift or continued audiovisual alignment.

## Sources

- Duke: [official player](https://duke.leanplayer.com/), published Leanstream live channel.
- Miami: [official radio affiliates](https://miamihurricanes.com/miami-hurricanes-football-radio-affiliates/), [WQAM official player](https://www.audacy.com/stations/wqam), public player-configured Amperwave channel.
- Virginia Tech: [official sports network](https://hokiesports.com/virginia-tech-sports-network), published WMT/Leanstream channel.

All three endpoints returned audio and allowed the site Origin during September 10, 2026 source probes. That proves transport availability at the time, not game content, geographic rights, or successful playback on a particular phone. Channels remain selectable independently of stale or unavailable schedule metadata. The Archive tab provides official Duke and Virginia Tech recordings. Miami currently links to its official listening site. The optional local Duke schedule adapter remains available for future use.

## Develop

Node.js 22.12 or later:

```sh
npm ci
npm test
npm run build
npm start
```

Open `http://127.0.0.1:4178/`. Tests use generated samples and mocked media boundaries; no private recordings are required. They are not device acceptance tests. The production app is static, with relative asset paths suitable for a repository subdirectory.

## Publish for phones

The repository's Pages workflow tests and builds on pushes to `main`; it deploys the resulting static assets to GitHub Pages. Enable **Settings → Pages → Source → GitHub Actions** once. See [GitHub's custom workflow instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Expected URL after a successful deployment: `https://michaeltorbert.github.io/homecall/`. Do not treat this as live until the workflow succeeds and the deployed assets are verified.

HTTPS is required on remote devices for the audio worklet and sharing features. Foreground iPhone/Android, Bluetooth, actual station playback, share-sheet delivery and commercial return behavior remain real-device acceptance checks. Automated browser inspection in this development environment is blocked by managed security policy; no alternate browser bypass was used.

## History and review

The original Duke automatic-sync prototype is preserved in commit `549a719b2a188f8166a8a50b586fe475d26b8bd1`. Its recognition code, experiments and model dependencies were removed from the active manual release, not erased from history. Private recordings/transcripts were never uploaded.

The manual plan received available-seat agreement from Codex, Claude, Grok and Gemini. Kimi was unavailable, so this is not full-roster consensus. Planning approval is separate from implementation review. See `PLAN.md`, `SYNC-DESIGN.md`, `REQUIREMENTS.md` and `BACKLOG.md` for the current contract and remaining checks.

## Archive

Choose Archive, then a school, sport, and year. Native audio controls provide play/pause and a seekable timeline, with playback speed and fine position adjustments. Pause at a distinctive play, then resume when it appears in a TV replay. Switching school or leaving Archive stops the recording; opening Archive disconnects live audio. No scores are imported; provider titles may contain spoilers. Game recordings are not guaranteed to contain the complete game.

The build fetches official Duke and Virginia Tech catalog metadata into ignored `public/archive.json`; no recordings are downloaded or hosted. Pages refreshes on deployment and every six hours. Source failures are isolated per school and shown as unavailable, with an official link. Refresh list reloads the published catalog, whose check time is shown. An unavailable source needs a later successful deployment refresh. Miami has no verified in-app archive feed. Local build requires network access for fresh listings; an offline build shows unavailable sources. Archive playback does not use or produce live-sync test logs.

### Archive source provenance

Verified September 10, 2026: the official Virginia Tech Sports Network page publishes `leanstream_college_id=9004` and `leanstreamProxyBaseUrl`; its linked `/_nuxt/DOLbHSEw.js` requests `?id=9004&archive=true` from `https://us-central1-lyrical-amulet-150218.cloudfunctions.net/wmt-leanstream-proxy-v2/`. This is the official page's configured service, not a Homecall-operated proxy. Hosts/paths may change; failures remain explicit rather than substituting an unverified feed. Duke's player similarly publishes the signed previous-events XML address discovered at build time. Strict recording URL validation may exclude unsupported filename formats.

Refresh list reloads the published catalog while preserving the current replay and filters. The six-hour cadence depends on GitHub Actions scheduling; the displayed check time is authoritative, and a manual workflow dispatch can refresh a stale deployment. Existing `mystream.*` browser storage keys remain for saved preferences/log compatibility.

## Remembering playback

Live streams save the chosen delay on this browser, separately for each source. Reconnecting restores that delay relative to incoming audio, without adding time spent disconnected. A fresh connection must collect enough audio first (a 35-second delay needs 35 seconds of incoming audio); the status shows progress and Live skips the wait. Continuous stalls keep the read position without replaying heard audio; drained buffer time is carried separately into the saved reconnect preference. Recovery retains history when the media position indicates a contiguous pause; a jump or unknown media position discards discontinuous history and refills the prior delay. Restoration does not prove alignment with the TV or the broadcaster's live edge.

Resume audio returns to the saved delay. If the TV was paused too, Resume where I stopped uses the retained audio while it remains available. A page reload, reconnect, or overwritten buffer cannot recover discarded audio. Phone interruptions may require a playback tap. Replay recordings remember their individual position; finished recordings start over. Only position values and real-clock save timestamps are stored locally, never audio. These preferences are separate from exportable session logs. Browser storage restrictions may prevent persistence.

### Georgia Tech live games (metadata service)

Choose **Georgia Tech**, select a football game, and wait for the playlist check
before pressing Play. The app obtains the anonymous Homestream team list and
football catalog, matches the returned team ID to the home/away side, and uses
that side's exact published HTTPS CloudFront address. No dated game URL or
account token is bundled. A published address is not proof of availability:
missing URLs, 404 responses, ended playlists and non-advancing playlists have
separate messages. Refresh games retries discovery.

HLS.js feeds the existing Web Audio/AudioWorklet delay engine; browsers without
MSE may use native HLS. Pause, hold/match, nudges, volume and the 180-second PCM
history retain their existing behavior. Saved delays are scoped to each game.
Reconnect stops playback, refreshes the catalog and rechecks availability; press
Play again when ready to restore the saved delay with a fresh buffer. Changing
games stops the previous feed and cancels pending discovery.

Run `npm run build` and `npm start` (or `PORT=4179 npm start`). The Node server
provides GET-only `/api/homestream/teams` and `/api/homestream/games/<team-id>`
routes against a fixed upstream host, returning only the fields needed by the
selector. It does not proxy media or forward credentials. Requests have a
bounded 8-second deadline covering the upstream fetch and body, and a 2 MiB
decoded JSON limit. Browser metadata and playlist requests retain their
10-second timeout. Playlist advancement is checked directly in the browser.

**Deployment:** the public catalog lacks CORS headers. The repository now includes
an optional Cloudflare Worker metadata gateway for the static Pages frontend;
it has been tested locally but has not been deployed or proven within the Free
CPU limit. See the setup and release gates below. Existing direct radio feeds
and Archive remain available on static hosting. A catalog error does not
silently fall back to a dated or unverified stream. This change does not add
Georgia Tech recordings to Archive or claim automatic TV synchronization.

### Sync tab (experimental)

The separate **Sync** tab brings the timestamped prototype into Homecall for
all schools returned by the public catalog (currently Duke, Georgia Tech,
Virginia and Auburn). It stops Live/Archive playback when entered and unloads
its own player and cancels timing requests when left. The original Live PCM
manual-delay controls remain separate and unchanged.

Select a school/game, wait for feed verification, then Play. Sync shows the
playing audio's real-world timestamp, local current time, estimated game-clock
anchor, and earliest/latest anchors inside the current HLS window. Enter a
quarter and TV clock to seek to the nearest available recorded play. Identical
clocks can refer to multiple plays; choose the matching description. Outside
window requests do not move playback. Bounds are not a promise that every
intermediate clock has a unique mapping. Back/ahead buttons allow manual
fine-tuning. Timestamp offsets reset when changing games or broadcast teams.

The fixed-host `/api/sync/teams`, `/api/sync/schedule/<team-id>/<year>` and
`/api/sync/plays/<event-id>` GET routes obtain minimized ESPN team, schedule and
play data. Matching requires both school names, a nearby game date and exactly
one event. Successful play polling runs every 15 seconds. After failures, retry
waits increase from 15 to 30, 60 and 120 seconds, resetting on success. The
45-second seek budget includes the server-reported age, the browser request
duration and local elapsed time. All clock seek paths, including saved play
choices, share that budget. Missing or invalid timing age, backward or uncertain
local clocks, and hidden-tab transitions invalidate timing. Returning to the
visible tab requires a fresh lookup; manual audio adjustment remains available. Out-of-order provider timestamps remain explicitly
unverified, never interpolated into a continuously ticking game clock.

Sync uses HLS.js playback positions, not Live's PCM buffer. In browsers falling
back to native HLS, audio and manual seeking may work but this implementation
cannot expose the program timestamp, so game-clock mapping stays unavailable.
No camera/microphone access, automatic TV sync, audible validation or locked
screen support is claimed. The metadata Worker must be deployed and configured before Sync discovery works
on static GitHub Pages. Local build and mock tests do not establish real browser
playback or precise alignment.

## Metadata Worker development and publishing

The Worker serves only five anonymous GET route families: Homestream teams and
football games, plus ESPN teams, schedules and plays. It does not relay audio,
playlists, arbitrary URLs, incoming credentials or request headers. Exact routes
reject queries and encoded variants. Upstream redirects are never followed:
workerd rejects `redirect: 'error'`, so the shared reader uses `manual` and rejects
all non-success responses, including every redirect. Invalid metadata returns
502; the full upstream deadline returns 504. No stale fallback is served.

`caches.default` is optional. Normalized team lists may be cached for 3,600 seconds,
games for 15 seconds, schedules for 300 seconds and plays for 10 seconds. Cache
errors act as misses; explicit check times prevent expired entries from extending
freshness. Every plays response includes integer `ageMs` recalculated at delivery
and unchanged `checkedAt`; the other four responses remain arrays. Browser
responses use `Cache-Control: no-store`; CORS is attached after cache lookup.
The only production browser Origin allowed is `https://michaeltorbert.github.io`
(Pages API verified September 12, 2026; no custom domain). Origin-less GET probes
are allowed. CORS restricts browser access, not authentication or quota abuse.

Local default builds use the existing same-origin Node routes. To exercise the
Worker on loopback instead:

```sh
npm run worker:dev
# In another terminal, build and start the frontend:
VITE_GATEWAY_ORIGIN=http://127.0.0.1:8787 npm run build
npm start
```

The local Worker permits exactly localhost/127.0.0.1 origins on ports 4178 and
4179, separately from production. `VITE_GATEWAY_ORIGIN` is public build-time
configuration consumed by both discovery interfaces. It must be a bare HTTPS
origin; loopback HTTP is allowed only in local/non-publishing builds. Paths,
trailing slashes, credentials, queries and fragments fail validation. Empty
configuration is valid locally and for PR builds; invalid explicit configuration
fails every build. `REQUIRE_GATEWAY=true` makes missing configuration fail before
the archive network refresh. The existing Pages workflow sets this flag only on
`main` publishing builds, including scheduled publishing, and reads repository
variable `VITE_GATEWAY_ORIGIN`. There is no automatic Worker deployment workflow.

```sh
npm test
npm run test:worker
npm run worker:dry-run
npm run worker:types
npm run build
```

`test:worker` bundles the actual entrypoint and runs local workerd HTTP tests with
fixture upstreams, including Cache API hits, per-delivery timing age, CORS,
redirect rejection, body limits and cancellation. A September 12 real-provider
probe through local workerd returned 200 for Homestream teams/games, but ESPN
returned 403 HTML access-denied responses for all three route families; the
gateway correctly returned unavailable (502). This remains a release blocker
for hosted Sync until the approved deployment can access those routes. No
access-denial bypass or header impersonation was attempted. These checks do not prove
platform CPU, deployed cache effectiveness, browser media CORS or audible output.
Generated bundles, local runtime state and generated types are ignored. Wrangler
and its local test runtime are pinned; the Worker itself needs no Node server,
paid storage binding or secret.

Publishing remains a separate authorized operation:

1. Confirm the target Cloudflare account, Free entitlement and a workers.dev
   subdomain or custom domain. The read-only September 12 account check found no
   Workers or workers.dev subdomain; entitlement was not independently confirmed.
   Account setup and deployment require approval; no paid upgrade is assumed.
2. After approval, select the verified account (for example through
   `CLOUDFLARE_ACCOUNT_ID`) and run `npm run worker:deploy`. Record the actual
   returned HTTPS origin. Do not invent a hostname to make publishing pass.
3. Before exposing the new frontend, verify deployed CORS and all upstream route
   families, cold and cached platform CPU on late-game/max-supported samples,
   deployed cache behavior and account-wide request usage. Re-serializing cached
   plays counts toward CPU. The 2 MiB limit is an initial memory bound, not a CPU
   guarantee; increasing cache TTL cannot fix an expensive cold invocation.
4. Set the Pages repository variable to the verified origin, run the required
   publishing build, then verify the deployed frontend and direct browser HLS in
   an allowed browser. Browser security-check failures are not bypassed. All open
   gates are recorded in `BACKLOG.md`.

Successful 15-second polling alone uses about 240 Worker requests per listener
hour, including cache hits. Sixty listeners over four hours use 57,600 plays
requests before catalog traffic, other listeners and other account usage. Backoff
reduces failed-poll traffic; it does not remove Free account limits. Quota or
metadata failures leave direct Live/Archive and manual audio controls usable,
although new catalog discovery may be unavailable.

Rollback requires the same explicit publication authorization: restore the last
known-good Worker version (`wrangler rollback` with the verified version/account)
or republish the last known-good frontend build. A gateway-origin change requires
a frontend rebuild. Do not clear the required publishing variable to bypass a
broken deployment; missing configuration is deliberately a publishing failure.


### Timing repair status (September 12, 2026)

The authorized production diagnostic deployment confirmed ESPN returns HTTP 403
HTML to the Worker; this is the cause of the timing routes' 502 responses.
Homestream discovery works independently. The supported-team endpoint now uses
verified Duke, Georgia Tech, Virginia and Auburn ID associations rather than a
large live ESPN team-list request. Games and stream URLs are still discovered
from the public Homestream catalog.

The Sync tab has a session-only **Game timing source** choice. **Homecall
service** uses the gateway; **Browser · manual sync only** explicitly requests
ESPN's public schedule/play routes from the browser. It does not switch
silently on errors. The browser alternative preserves unknown freshness and
cannot enable game-clock seeking; it can display recorded anchors when CORS
and stream timestamps are available. Manual playback and delay controls remain
usable. Retry timing does not restart audio.

Timing schema 2 binds both teams, season and event identity. Upstream HTTP age,
request duration and cache residence are counted conservatively; absent or
invalid Date/Age evidence stays unknown. HTTP freshness still does not establish
sports reporting latency or TV alignment. Repeated/nearest clocks require a
choice, corrected snapshots invalidate prior choices, and invalid corrections
withdraw obsolete anchors. Play timestamps require an explicit timezone and a
valid calendar date. Calibration resets on event, feed or timing-source changes.

Production schedule/play access, actual browser/HLS/TV validation, account
entitlement/usage and successful-path platform CPU remain open release gates in
`BACKLOG.md`. The frontend is not published merely because the build passes.
The separate temporary player on port 8767 is unchanged.
