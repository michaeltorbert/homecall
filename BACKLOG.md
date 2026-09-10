# Follow-up and acceptance work

## Required live acceptance (open)

- **DEVICE-01**: On an actual iPhone and Android, open the deployed HTTPS site, play each team source, confirm audible delayed output, exercise pause/scrub/rapid nudges/two-tap/cancel and export the session. Transport probes and component mocks do not satisfy this.
- **MIAMI-01**: Confirm WQAM carries the intended Miami game for the listener's location during coverage. If rights block it, retain the official-player link and unavailable explanation; do not bypass restrictions.
- **SHARE-01**: Confirm native JSON share to Mail/Messages, clipboard and download on another person's phone. Verify the received payload matches the preview and that canceling sharing retains the local log.
- **CONTINUITY-01**: Measure behavior over a full game including commercial returns, phone calls, app switching, screen lock and Bluetooth changes. Foreground operation is the current target; background support is unverified.
- **VISUAL-01**: Inspect actual 320–430px phone layouts, keyboard focus and slider interaction in a permitted browser. Current managed browser inspection is blocked by policy; no bypass allowed.
- **HOST-01**: Enable repository Pages via GitHub Actions, complete deployment, verify published assets and provide a working phone URL. The Codex App currently has no Pages permission.

## Deferred product work

- **DATA-01**: Import JSON logs into a spreadsheet/server only after the user has real sessions and a useful analysis question. CSV export requires safe cell handling. No Google OAuth or server ingestion is necessary for v1.
- **SOURCES-01**: Add replays and CORS-safe schedule adapters without gating live channels on stale metadata. Validate naive timezone fields against publisher semantics before calling them authoritative.
- **AUTO-01**: Decide whether automatic assistance is worthwhile from correction episodes, uncertainty intervals and user reports. Do not infer true drift from each nudge or claim ongoing alignment from a confirmation interval.
- **AUDIO-01**: Measure memory and battery on older phones before changing the approximately 69 MB stereo float buffer at 48 kHz. Consider narrower storage only with evidence.
- **UX-01**: Consider Media Session and wake-lock integration after actual foreground operation is verified; neither proves background continuity.

## Planning disposition

The accepted plan incorporates continuity clocks and uncertainty, deterministic cancel, grouped correction episodes, privacy allowlists, engine-atomic nudges, source epochs and zero-delay TV guidance. Claims that an expired schedule must block a known live channel, that silence necessarily proves a stall, and that a redundant Miami fallback requires new scope were rejected. Four reviewers accepted the dispositions; Kimi was unavailable. No reviewer exclusion was adopted.
