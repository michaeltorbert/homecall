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

The network backup is the `img.leanstream.co/IM3501-MP3` address published by [Varsity's Duke player](https://thevarsitynetwork.com/feed/source/oas-1693); it shares the primary's broadcast provider. The three stations are listed among [Duke's affiliates](https://goduke.com/sports/2022/8/6/local-radio-affiliates) and carried postgame interview audio in September 12, 2026 samples. Their programming and availability can change, so the app never automatically switches stations or promises that a game is currently on. WKRX carried postgame during direct sample checks but failed the in-app connection check, so it is not included. The official-player link follows the selected feed, and logs identify that feed without recording its URL.

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

Choose Archive, then a school, sport, and year. Native audio controls provide play/pause and a seekable timeline, with playback speed and fine position adjustments. Pause at a distinctive play, then resume when it appears in a TV replay. Switching school or leaving Archive stops the recording; opening Archive disconnects live audio. No scores are imported; provider titles may contain spoilers. Game recordings are not guaranteed to contain the complete game.

The build fetches official Duke and Virginia Tech catalog metadata into ignored `public/archive.json`; no recordings are downloaded or hosted. Pages refreshes on deployment and every six hours. Source failures are isolated per school and shown as unavailable, with an official link. Refresh list reloads the published catalog, whose check time is shown. An unavailable source needs a later successful deployment refresh. Miami has no verified in-app archive feed. Local build requires network access for fresh listings; an offline build shows unavailable sources. Archive playback does not use or produce live-sync test logs.

### Archive source provenance

Verified September 10, 2026: the official Virginia Tech Sports Network page publishes `leanstream_college_id=9004` and `leanstreamProxyBaseUrl`; its linked `/_nuxt/DOLbHSEw.js` requests `?id=9004&archive=true` from `https://us-central1-lyrical-amulet-150218.cloudfunctions.net/wmt-leanstream-proxy-v2/`. This is the official page's configured service, not a Homecall-operated proxy. Hosts/paths may change; failures remain explicit rather than substituting an unverified feed. Duke's player similarly publishes the signed previous-events XML address discovered at build time. Strict recording URL validation may exclude unsupported filename formats.

Refresh list reloads the published catalog while preserving the current replay and filters. The six-hour cadence depends on GitHub Actions scheduling; the displayed check time is authoritative, and a manual workflow dispatch can refresh a stale deployment. Existing `mystream.*` browser storage keys remain for saved preferences/log compatibility.

## Remembering playback

Live streams save the chosen delay on this browser, separately for each source. Reconnecting restores that delay relative to incoming audio, without adding time spent disconnected. A fresh connection must collect enough audio first (a 35-second delay needs 35 seconds of incoming audio); the status shows progress and Live skips the wait. Continuous stalls keep the read position without replaying heard audio; drained buffer time is carried separately into the saved reconnect preference. Recovery retains history when the media position indicates a contiguous pause; a jump or unknown media position discards discontinuous history and refills the prior delay. Restoration does not prove alignment with the TV or the broadcaster's live edge.

Resume audio returns to the saved delay. If the TV was paused too, Resume where I stopped uses the retained audio while it remains available. A page reload, reconnect, or overwritten buffer cannot recover discarded audio. Phone interruptions may require a playback tap. Replay recordings remember their individual position; finished recordings start over. Only position values and real-clock save timestamps are stored locally, never audio. These preferences are separate from exportable session logs. Browser storage restrictions may prevent persistence.
