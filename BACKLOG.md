# Follow-up and acceptance work

## Required live acceptance (open unless noted)

- **DEVICE-01** (iPhone closed September 19 on the production site: radio with delay nudges and a game stream; Android untested by the owner's decision): On an actual iPhone and Android, open the deployed HTTPS site, play each team source, confirm audible delayed output, exercise pause/scrub/rapid nudges/two-tap/cancel and export the session. Transport probes and component mocks do not satisfy this.
- **MIAMI-01**: Confirm WQAM carries the intended Miami game for the listener's location during coverage. If rights block it, retain the official-player link and unavailable explanation; do not bypass restrictions.
- **SHARE-01**: Confirm native JSON share to Mail/Messages, clipboard and download on another person's phone. Verify the received payload matches the preview and that canceling sharing retains the local log.
- **CONTINUITY-01** (September 19: screen lock for five minutes and app switching passed on iPhone; commercial returns, phone calls and Bluetooth remain unobserved): Measure behavior over a full game including commercial returns, phone calls, app switching, screen lock and Bluetooth changes. Foreground operation is the current target; background support is unverified.
- **VISUAL-01**: Inspect actual 320–430px phone layouts, keyboard focus and slider interaction in a permitted browser. Current managed browser inspection is blocked by policy; no bypass allowed.

## Deferred product work

- **DATA-01**: Import JSON logs into a spreadsheet/server only after the user has real sessions and a useful analysis question. CSV export requires safe cell handling. No Google OAuth or server ingestion is necessary for v1.
- **SOURCES-01**: Add replays and CORS-safe schedule adapters without gating live channels on stale metadata. Validate naive timezone fields against publisher semantics before calling them authoritative.
- **AUTO-01**: Decide whether automatic assistance is worthwhile from correction episodes, uncertainty intervals and user reports. Do not infer true drift from each nudge or claim ongoing alignment from a confirmation interval.
- **AUDIO-01**: Measure memory and battery on older phones before changing the approximately 69 MB stereo float buffer at 48 kHz. Consider narrower storage only with evidence.
- **UX-01**: Consider Media Session and wake-lock integration after actual foreground operation is verified; neither proves background continuity.

## Planning disposition

The accepted plan incorporates continuity clocks and uncertainty, deterministic cancel, grouped correction episodes, privacy allowlists, engine-atomic nudges, source epochs and zero-delay TV guidance. Claims that an expired schedule must block a known live channel, that silence necessarily proves a stall, and that a redundant Miami fallback requires new scope were rejected. Four reviewers accepted the dispositions; Kimi was unavailable. No reviewer exclusion was adopted.

## Hosting configuration

GitHub Pages was enabled with GitHub Actions by the user on September 10, 2026; repository metadata confirms it. Deployment and commit identity are verified through the repository workflow before sharing the phone link. The workflow remains the current source of deployment status.

## Metadata gateway release gates (open)

- **GATEWAY-ACCOUNT-01**: User authorized and deployed `https://homecall-metadata.homecall.workers.dev` on September 12. Account/subdomain/deployment authorization are resolved. Independently confirm the account Free entitlement and remaining account-wide usage before public release; no paid upgrade is authorized or assumed.
- **GATEWAY-CPU-01**: Measure actual deployed platform CPU for cold misses and cache hits, including large late-game/max-supported ESPN summaries and response re-serialization, against the selected Free entitlement. Local workerd tests and Node CPU samples are not platform proof. Keep this open until measurements pass; TTL increases cannot resolve cold-invocation CPU. Revisit the initial 2 MiB decoded-body bound only with supported-payload evidence.
- **GATEWAY-CACHE-01**: Verify Cache API effectiveness at the actual deployed origin, hit/expiry behavior and per-delivery age. Local workerd proves a local hit only. Use workers.dev or ensure the custom-zone Worker route covers the internal `/__metadata_cache_v2` namespace as well as `/api/`; verify internal cache URLs return 404 through the Worker. Behavior on a narrower custom-zone route remains unverified. Deployment must remain correct when cache lookup/write fails or always misses, without stale fallback.
- **GATEWAY-USAGE-01**: Measure steady-state account-wide requests and quota failures before release. Plays alone cost about 240 requests/listener-hour at 15-second polling; 60 listeners over four hours use 57,600 before other traffic. Backoff limits outage amplification, and CORS does not prevent non-browser quota use. No automatic paid upgrade.
- **GATEWAY-HOST-01**: Production diagnostic version `164290fb-29e4-41e0-9fa9-1b93a3f93550` proved all three ESPN upstream requests return HTTP 403 HTML (September 13 UTC); the gateway's 502 was masking upstream refusal. The supported-team lookup now uses four verified provider associations without that upstream dependency. Schedule/play access from the Worker remains blocked. The explicit browser alternative supports user-confirmed historical-play seeking with unknown age, never a live-clock estimate or automatic fallback. Before publishing, prove permitted browser transport and useful behavior; no access-denial evasion or invented freshness. Do not set Pages `VITE_GATEWAY_ORIGIN` or merge for release until the selected path meets acceptance.
- **GATEWAY-BROWSER-01**: In a permitted real browser/device, prove the deployed gateway plus direct CloudFront HLS playlist advancement, audible playback and manual controls, stale/hidden-tab clock-seek behavior, and metadata-failure isolation. The managed browser security check remains unavailable as of September 12; no alternate browser bypass. Runtime HTTP fixtures do not close this gate or VISUAL-01/DEVICE-01.


## Timing repair follow-ups

- **TIMING-01**: Validate actual browser CORS, HLS audio/timestamps, seek windows and manual TV calibration. The managed browser policy check remains unavailable; component tests and HTTP delivery are not substitutes. The temporary player remains unchanged.
- **TIMING-02**: The explicit historical-play mode is implemented separately from the 45-second service-source policy. Browser snapshots retain unknown age, every play requires confirmation, and failures/corrections/source or visibility changes invalidate choices. Automated tests cover these contracts. Real-browser and audio/TV acceptance remains open under TIMING-01; no continuous or current-clock estimate is enabled.
- **TIMING-03**: Deferred: automatic identity mapping beyond the four verified schools, overtime clock seeking, native-HLS timestamp extraction. User-confirmed historical seeking is implemented under TIMING-02, with actual browser acceptance still open. No continuous clock extrapolation or automatic TV alignment claim.
- **TIMING-04**: If a different provider is needed, verify actual event timestamp semantics, coverage and costs first. No speculative host migration, provider purchase or automatic retry fanout.

## Private stream rollout — released as 0.4.0 on September 19

Production has run on the private gateway since September 19 (PR #11, acceptance record #12, release #15/#16). The preview Worker `homecall-private-streams-preview` remains for testing. RELEASE-CHECKLIST.md records the switch-over and rollback steps.

- **RELAY-ACCEPT-01 — closed:** all seven radio sources including both custom ports; Miami's six-destination redirect pool and Virginia Tech's cold-start replay redirect handled through private catalog configuration; archive HEAD/Range; iPhone (iOS 18.7 Safari) radio with delay nudges and game streams, including a five-minute locked-screen run; four-hour unattended game stream with no errors. Android, Bluetooth and phone-call interruptions were not tested (owner's decision; see DEVICE-01 and CONTINUITY-01).
- **RELAY-HLS-01 — closed:** all four Homestream schools share one provider origin and playlist shape (one-second segments, 350-entry window, `+0000` offsets, no encryption keys, no master, no signed URLs); live game streams for Georgia Tech, Duke, Auburn and Virginia played through the gateway, with timestamp seeking in the browser. Game capabilities last six hours; a bad capability answers 403.
- **RELAY-FREE-01 — closed with a capacity note:** on the native path a four-hour radio relay costs about 2 ms CPU and a game-stream playlist reload p50 4–6 / p99 8–14 ms; no invocation exceeded the CPU limit across the day. Capacity is arithmetic: each game-stream listener costs about 7,200 requests/hour plus one KV read per request, so Workers Free supports roughly three simultaneous game-stream listeners per game day; radio listeners cost about one request per session. Sharing more widely needs a paid plan.
- **RELAY-RELEASE-01 — closed:** production KV and key provisioned, catalog uploaded with a private rollback copy, Worker deployed and verified before the site switched, scheduled refresh enabled, rollback versions recorded (Worker `4e93d47e`, site `da44f8f`).
- **SYNC-RECOVER-01 (found September 19, not fixed):** `SyncPlayer` restarts from the entry after a fatal player error with 1/2/4-second waits, but `recovery.attempts` is never reset after a successful reconnect, so the fourth fatal error over a long session stops playback with "The stream stopped" even when each earlier reconnect worked. Reset the counter after sustained playback (for example 60 seconds of `playing`).
- **SYNC-RECOVER-02 (found September 19, not fixed):** a reconnect restarts at the live edge and asks the listener to "check alignment", discarding the delay they set. Record the playing program date before the restart and seek back to it once the new level is loaded, falling back to the live edge only when that timestamp is outside the window. Server-side, game capabilities now last six hours and expired ones answer 403, so expiry no longer causes this during a game; provider hiccups still do.
