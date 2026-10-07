# Homecall

A small manual-sync internet audio player for Duke, Miami and Virginia Tech. Open the site, choose your team, and delay the call to match your TV. No account, microphone, camera or recognition model is required.

## Listen and align

1. Choose a team and press **Play**. Keep the page in the foreground for this first version.
2. If the call arrives before the TV picture, use **Match a play**: tap when you hear a distinctive play, then tap again when you see it. Audio pauses between taps while the incoming history keeps filling.
3. Fine-tune with **±5 s, ±1 s or ±¼ s**, or the delay slider. Press **Sounds aligned** to mark the result in your log.
4. Check alignment after commercials or interruptions. If the call is late even at zero delay, pause your TV until it catches up. This app cannot play audio from the future.

Pause keeps collecting audio for up to three minutes. A buffer overrun cancels a pending match and leaves audio paused. Canceling a match restores the delay from before the first tap relative to the current incoming edge; it skips the abandoned hold. Reconnecting or switching teams discards the previous buffer. If a user timing command cannot be acknowledged, the app disconnects rather than allowing that queued change to apply unexpectedly later; reconnect when ready. The displayed delay is what this app adds, **not total stadium-to-listener latency**.

## Backup feeds

For Duke, use **Audio feed** above Play to choose the network's backup connection or WSJS, WCCG, or WTIB. Changing the feed stops playback. Press Play to start the new feed with a fresh buffer and zero added delay, then check alignment. Reconnecting the same feed restores its own saved delay. Switching teams returns to that team's primary feed; feed selection itself is not saved across reloads.

The network backup is the private alternate address published by [Varsity's Duke player](https://thevarsitynetwork.com/feed/source/oas-1693); it shares the primary's broadcast provider. The three stations are listed among [Duke's affiliates](https://goduke.com/sports/2022/8/6/local-radio-affiliates) and carried postgame interview audio in September 12, 2026 samples. Their programming and availability can change, so the app never automatically switches stations or promises that a game is currently on. WKRX carried postgame during direct sample checks but failed the in-app connection check, so it is not included. The official-player link follows the selected feed, and logs identify that feed without recording its URL.

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

HTTPS is required on remote devices for the audio worklet and sharing features. Foreground iPhone/Android, Bluetooth, actual station playback, share-sheet delivery and commercial return behavior remain real-device acceptance checks. Desktop browser checks do not replace those real-device acceptance checks.

## History and review

The original Duke automatic-sync prototype is preserved in commit `549a719b2a188f8166a8a50b586fe475d26b8bd1`. Its recognition code, experiments and model dependencies were removed from the active manual release, not erased from history. Private recordings/transcripts were never uploaded.

The manual plan received available-seat agreement from Codex, Claude, Grok and Gemini. Kimi was unavailable, so this is not full-roster consensus. Planning approval is separate from implementation review. See `PLAN.md`, `SYNC-DESIGN.md`, `REQUIREMENTS.md` and `BACKLOG.md` for the current contract and remaining checks.

## Archive

Choose Archive, then a school, sport, and year. Native audio controls provide play/pause and a seekable timeline, with playback speed and fine position adjustments. Pause at a distinctive play, then resume when it appears in a TV replay. Switching school or leaving Archive stops the recording. Live radio keeps playing while you look at other tabs; starting a recording or a Sync game stream stops it, so only one call plays at a time. No scores are imported; provider titles may contain spoilers. Game recordings are not guaranteed to contain the complete game.

Archive listings come from the gateway's private catalog. The Worker refreshes sources every six hours when its single publisher is enabled. Failed refreshes preserve the last good recordings and their original check time, marked stale. Successful empty listings replace old entries. Refresh list reloads that catalog without rebuilding the site. Builds perform no provider discovery and contain no recording addresses. Miami links to its official listening site.

## Remembering playback

Live streams save the chosen delay on this browser, separately for each source. Reconnecting restores that delay relative to incoming audio, without adding time spent disconnected. A fresh connection must collect enough audio first (a 35-second delay needs 35 seconds of incoming audio); the status shows progress and Live skips the wait. Continuous stalls keep the read position without replaying heard audio; drained buffer time is carried separately into the saved reconnect preference. Recovery retains history when the media position indicates a contiguous pause; a jump or unknown media position discards discontinuous history and refills the prior delay. Restoration does not prove alignment with the TV or the broadcaster's live edge.

Resume audio returns to the saved delay. If the TV was paused too, Resume where I stopped uses the retained audio while it remains available. A page reload, reconnect, or overwritten buffer cannot recover discarded audio. Phone interruptions may require a playback tap. Replay recordings remember their individual position; finished recordings start over. Only position values and real-clock save timestamps are stored locally, never audio. These preferences are separate from exportable session logs. Browser storage restrictions may prevent persistence.

### Georgia Tech live games (metadata service)

Choose **Georgia Tech**, select a football game, and wait for the playlist check
before pressing Play. The app obtains the anonymous Homestream team list and
football catalog, matches the returned team ID to the home/away side, and uses
a gateway address for that side's privately discovered feed. No dated game URL or
account token is bundled. A published address is not proof of availability:
missing URLs, 404 responses, ended playlists and non-advancing playlists have
separate messages. Refresh games retries discovery.

HLS.js feeds the existing Web Audio/AudioWorklet delay engine; browsers without
MSE may use native HLS. Pause, hold/match, nudges, volume and the 180-second PCM
history retain their existing behavior. Saved delays are scoped to each game.
Reconnect stops playback, refreshes the catalog and rechecks availability; press
Play again when ready to restore the saved delay with a fresh buffer. Changing
games stops the previous feed and cancels pending discovery.

The gateway owns provider discovery and media transport. The browser receives stable stream IDs and gateway URLs; it never receives upstream media addresses in catalog JSON or playlist references. Audio still reaches the listener, so this is address concealment rather than copy protection. Official attribution links remain public.

See [PRIVATE-STREAMS.md](PRIVATE-STREAMS.md) for configuration, rollout gates and local development. This implementation has not replaced the production gateway until the separate rollout checks are satisfied. Provider availability and permitted relay use remain acceptance gates.

### Sync tab (experimental)

The separate **Sync** tab brings the timestamped prototype into Homecall for
all schools returned by the public catalog (currently Duke, Georgia Tech,
Virginia and Auburn). Live radio keeps playing until a Sync game stream is
started; Sync unloads its own player and cancels timing requests when left. The original Live PCM
manual-delay controls remain separate and unchanged.

Select a school/game, wait for feed verification, then Play. Sync shows the
playing audio's real-world timestamp, local current time, estimated game-clock
anchor, and earliest/latest anchors inside the current HLS window. Enter a
quarter and TV clock to find the nearest available recorded play. Every result
requires confirming a play description before audio moves. Identical
clocks can refer to multiple plays; choose the matching description. Outside
window requests do not move playback. Bounds are not a promise that every
intermediate clock has a unique mapping. Back/ahead buttons allow manual
fine-tuning. Timestamp offsets reset when changing games or broadcast teams.

The fixed-host `/api/sync/teams`, `/api/sync/schedule/<team-id>/<year>` and
`/api/sync/plays/<event-id>` GET routes obtain minimized ESPN team, schedule and
play data. Matching requires both school names, a nearby game date and exactly
one event. Successful play polling runs every 15 seconds. After failures, retry
waits increase from 15 to 30, 60 and 120 seconds, resetting on success. The
45-second seek budget for **Homecall service** includes the server-reported age,
the browser request duration and local elapsed time. All service-source seek
paths, including saved play choices, share that budget. **ESPN recorded plays**
is a separate user-selected historical mode described below; it preserves
unknown freshness and requires explicit confirmation for every seek. Missing or invalid timing age, backward or uncertain
local clocks, and hidden-tab transitions invalidate timing. Returning to the
visible tab requires a fresh lookup; manual audio adjustment remains available. Out-of-order provider timestamps remain explicitly
unverified, never interpolated into a continuously ticking game clock.

**Game status labels.** Each Sync game option starts with **LIVE**,
**Upcoming**, **Completed** or **Status unavailable**, followed by the existing
date, opponent and feed notice. The labels come from
`/api/sync/status/<team-id>/<year>`, a GET route limited to the four verified
provider team IDs. It reads the same ESPN team schedule and returns schema 1:
`teamId`, `season`, `checkedAt`, `ageMs` and events containing only identity
fields plus a status of `live`, `upcoming`, `completed` or `unknown`. The
gateway caches it for 10 seconds and recomputes age on every delivery; an
expired entry is never served after a failure. Only these provider triples are
confident: `STATUS_SCHEDULED`/`pre`/not completed (Upcoming),
`STATUS_IN_PROGRESS` or `STATUS_HALFTIME`/`in`/not completed (LIVE), and
`STATUS_FINAL`/`post`/completed (Completed). Final and scheduled shapes were
observed in the public schedule; the in-progress and halftime shapes are the
supported contract, not yet observed live. Any other name (postponed, canceled,
delayed or new), a malformed status, or event- and competition-level copies that
disagree is unknown. Labels never come from kickoff time or feed state.

The page polls up to the two most recent catalog seasons, one request at a time
per season. It polls every 15 seconds after success, and after failures waits
30, 60, then 120 seconds. A label uses the same 45-second budget as service
timing: upstream age, cache residence, request duration and local elapsed time
all count. Unknown age, a failed or slow refresh, or a clock step shows
**Status unavailable**. So do games without a kickoff time, games in older
seasons, and ambiguous matches, including two catalog games that claim the same
event. Hiding the tab or leaving Sync stops polling. Status updates change only
the option text; they never start, stop or reload audio, change the selected
game, or touch calibration, timing source or play anchors. LIVE means the
sports-data source reports the game in progress. It can lag the actual game, and
it does not mean a feed is published or playable.

Sync uses HLS.js playback positions, not Live's PCM buffer. In browsers falling
back to native HLS, audio and manual seeking may work but this implementation
cannot expose the program timestamp, so game-clock mapping stays unavailable.
No camera/microphone access, automatic TV sync, audible validation or locked
screen playback support is claimed. Now Playing metadata is best-effort; see the
Now Playing section below. The metadata Worker must be deployed and configured before Sync discovery works
on static GitHub Pages. Local build and mock tests do not establish real browser
playback or precise alignment.

**Reconnects.** After a fatal stream error or 20 seconds of startup or
buffering silence, Sync reconnects to the same broadcast up to three times
(1, 2 and 4 seconds apart). The retry allowance renews only after 30 seconds of
continuously observed media progress at the selected playback rate. Playing
events and timers earn no credit. Frozen or jumping audio, pauses, seeks and
buffering restart the 30 seconds. While audio plays normally, Sync
remembers the playing broadcast timestamp. After a reconnect it tries to return to that
timestamp plus the real time spent disconnected, keeping your delay relative to
the TV. It moves only when the remembered and target timestamps, and the
incoming edge, each map to exactly one fragment in both directions (timestamp to
audio position and back) inside the reloaded seekable window. A fragment shared
by both playlists must also prove the timeline is continuous, the incoming-edge
delay must be consistent, and the remembered position must be under two minutes
old. If no return is attempted, audio plays from the incoming broadcast and the
status says so. If a return was attempted but could not be confirmed, the status
makes no claim about where audio is; check it against the TV. A session that
never played verifiably simply resumes from the incoming broadcast. Native-HLS
browsers without exposed timestamps always use the manual fallback. You may
briefly hear incoming audio before the return, and loading after the seek adds
delay. Success is reported once the player reports reaching the restored
position (a completed seek or qualified progress from it). That observes the
position; it does not guarantee continued playback or lasting TV alignment.
While reconnected audio is loaded, pressing Back/Ahead, Jump to incoming audio
or a play choice, pausing, or touching or keyboard-operating the audio controls
cancels a pending return. While waiting to reconnect, the audio is unloaded and
the in-page movement controls are disabled. Touching or keyboard-operating the
audio controls still cancels the return, and Stop remains available. A later
playback change also clears the
completed recovery message. Phone lock-screen, media-session or accessibility
seeks cannot be identified as yours during that short window. Such a seek may be
overridden once by the return. Always check alignment with your TV afterward;
TV sync is not guaranteed. A reconnect also clears play choices already shown,
but it keeps the timestamp offset and timing source.

## Now Playing on the lock screen and in the car (issue #19)

While audio plays, Homecall publishes Now Playing metadata through the browser's
Media Session API. Phone lock screens and connected car displays read it. Only
metadata is written. Homecall registers no action handlers and writes no position
or playback state, so the existing play/pause controls, delay, calibration, Sync
recovery and Archive bookmarks behave as before. A session is claimed only when
you start playback, never by changing tabs, picking a team or game, or a feed
becoming ready. Stopping, switching sources, a failed start and other terminal
stops clear it. A later session always replaces an earlier one, and an earlier
session can never clear its replacement.

**What is shown.** Every mode shows one original Homecall image,
`now-playing/homecall-512.png` (see `public/now-playing/PROVENANCE.md`). It shows
no team logos. The text identifies the audio:

- **Live radio** (Duke, Miami, Virginia Tech and Duke affiliates): the station
  name and school. Radio is never matched to a game from the kickoff time or a
  single live event, so it never shows a score.
- **Live game** (Georgia Tech catalog games) and **Sync game** (all four
  supported schools): the catalog matchup, for example "Georgia Tech vs Duke".
- **Archive**: the recording's school and opponent, with no score or result.
- **Timing demo**: a test-tone label.

**Score, period and clock (catalog-bound games only).** While the game audio is
actually playing, the page reads the existing `/api/sync/status/<team-id>/<year>`
envelope every 15 seconds. That route gained one backward-compatible optional
field on live events only: `scoreboard: {phase, period?, clock?, scores?}`. The
status enum and the other events are unchanged. The scoreboard keeps:

- the period;
- a regulation clock, only when the numeric and displayed clocks agree;
- both scores, keyed by provider team ID, only when both are well-formed.

Halftime and overtime clocks, contested copies and anything malformed are left
out. A missing score never erases a valid period or clock, and half a score is
never shown.

The source and the time Homecall received the data share the title field with
the score, and come before it:

`Live · ESPN data received 10/7, 3:41 PM · Georgia Tech 17, Duke 14 · Q2 7:29`

That time is when Homecall received the snapshot. It is not when the play
happened, and the clock does not tick between snapshots. Homecall controls only
the field contents. Phones and cars may truncate, lay out, display or cache the
fields independently, so there is no native guarantee that the source and time
stay visible next to the score.

These remove the score and clock, leaving the matchup and artwork. The removal
happens when page JavaScript runs: on the triggering event, or within about one
second through the watchdog. There is no deadline while the OS has the page
suspended.

- pausing, holding or restoring a delay;
- a phone audio interruption or reconnect;
- a stale or unknown snapshot age (the same 45-second budget as status labels);
- a clock step or failed request;
- the game leaving live status, or an ambiguous match.

Each playing session freezes the first provider event it matches; a different
event never inherits it. Failures back off 30, 60, then 120 seconds. A status
failure never stops audio. Polling continues while the tab is hidden as long as
that game audio keeps playing. Returning to the tab checks expiry before
refreshing. `pagehide` and `freeze` clear the score; `pageshow` and `resume`
revalidate.

**Limits.** Homecall cannot control how phones or cars lay out, truncate or
cache this text and artwork. The browser's metadata has no expiry. If the OS
suspends the page without a lifecycle event, an old score can stay on the lock
screen until JavaScript runs again, and background timers may be throttled, so
updates are best-effort. Sports data can lag the game, and delayed radio
commentary can be ahead of or behind it. Browser API checks are not phone or car
acceptance; see BACKLOG `NOW-PLAYING-01`.

## Gateway development and publishing

See [PRIVATE-STREAMS.md](PRIVATE-STREAMS.md) for the current private catalog and relay configuration, tests and rollout gates.

### Timing repair status (September 12, 2026)

The authorized production diagnostic deployment confirmed ESPN returns HTTP 403
HTML to the Worker; this is the cause of the timing routes' 502 responses.
Homestream discovery works independently. The supported-team endpoint now uses
verified Duke, Georgia Tech, Virginia and Auburn ID associations rather than a
large live ESPN team-list request. Games and stream URLs are still discovered
from the public Homestream catalog.

The Sync tab asks for a session-only **Game timing source** choice. **ESPN
recorded plays · confirm before seeking** requests only ESPN's public CORS-enabled
schedule/summary routes directly from the browser, with no credentials, redirect
following or proxy. **Homecall service** retains its bounded-age seek policy. No
source is selected implicitly and no failure silently switches sources. Catalog
discovery and the verified four-school ID mapping still use the Worker.

Recorded-play mode is historical navigation: it maps a reported play timestamp
into an unambiguous, currently seekable HLS fragment. It does not estimate the
current game clock. Unknown HTTP age remains unknown, since ESPN does not expose
Date/Age to browser code. Neither HTTP age nor the play's wallclock establishes
reporting delay or precise stadium-to-audio alignment. A 45-second cache-age
limit is not needed to let the user inspect and deliberately select a historical
record; this mode therefore does not borrow or weaken the service-source policy.
Latest plays and corrections may be missing, and the UI says so.

Choose **ESPN recorded plays**, enter the TV quarter/clock, and press **Find
recorded play**. Nothing moves until you select a described play, including an
exact unique match. Compare the audio with that play on TV and use back/ahead
buttons to fine-tune. The result explicitly says this does not confirm alignment.
Repeated clocks show all matching descriptions, nearest matches show the distance,
and out-of-window requests never move audio. Poll failures pause recorded-play
seeking; valid recovery reenables it. New snapshots, source/feed/game changes,
hiding the tab, calibration edits and stopping/restarting playback invalidate old
choices. Seek positions are recalculated against the current HLS window at click
time. Native-HLS browsers without exposed timestamps retain manual controls.

September 13 Node HTTP probes returned 200 with `Access-Control-Allow-Origin: *`
for all four schedules and a Georgia Tech summary (168 reported plays). These
probes verify public source responses only. They are not real-browser CORS,
audible playback, timestamp accuracy or TV-alignment tests. No alternate provider
or hosting migration is needed for this bounded candidate; a contracted provider
remains a future option if actual browser acceptance or timestamp usefulness fails.

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
