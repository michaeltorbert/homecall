# myStream

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

All three endpoints returned audio and allowed the site Origin during September 10, 2026 source probes. That proves transport availability at the time, not game content, geographic rights, or successful playback on a particular phone. Channels remain selectable independently of stale or unavailable schedule metadata. Replays are deferred in this manual release. The optional local Duke schedule adapter remains available for future use.

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

Expected URL after a successful deployment: `https://michaeltorbert.github.io/mystream/`. Do not treat this as live until the workflow succeeds and the deployed assets are verified.

HTTPS is required on remote devices for the audio worklet and sharing features. Foreground iPhone/Android, Bluetooth, actual station playback, share-sheet delivery and commercial return behavior remain real-device acceptance checks. Automated browser inspection in this development environment is blocked by managed security policy; no alternate browser bypass was used.

## History and review

The original Duke automatic-sync prototype is preserved in commit `549a719b2a188f8166a8a50b586fe475d26b8bd1`. Its recognition code, experiments and model dependencies were removed from the active manual release, not erased from history. Private recordings/transcripts were never uploaded.

The manual plan received available-seat agreement from Codex, Claude, Grok and Gemini. Kimi was unavailable, so this is not full-roster consensus. Planning approval is separate from implementation review. See `PLAN.md`, `SYNC-DESIGN.md`, `REQUIREMENTS.md` and `BACKLOG.md` for the current contract and remaining checks.
