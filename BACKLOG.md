# Follow-up and acceptance work

## Required live acceptance (open)

- **DEVICE-01**: On an actual iPhone and Android, open the deployed HTTPS site, play each team source, confirm audible delayed output, exercise pause/scrub/rapid nudges/two-tap/cancel and export the session. Transport probes and component mocks do not satisfy this.
- **MIAMI-01**: Confirm WQAM carries the intended Miami game for the listener's location during coverage. If rights block it, retain the official-player link and unavailable explanation; do not bypass restrictions.
- **SHARE-01**: Confirm native JSON share to Mail/Messages, clipboard and download on another person's phone. Verify the received payload matches the preview and that canceling sharing retains the local log.
- **CONTINUITY-01**: Measure behavior over a full game including commercial returns, phone calls, app switching, screen lock and Bluetooth changes. Foreground operation is the current target; background support is unverified.
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
