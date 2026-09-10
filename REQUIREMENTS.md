# Current requirements — manual v1

The user's September 10, 2026 decision supersedes the original automatic-first prototype.

- Duke, Miami Hurricanes and Virginia Tech live internet audio with truthful station and availability labels.
- Three-minute rolling PCM history; pause/play, direct delay scrub, ±5/1/0.25 seconds, jump to incoming audio.
- Two-tap match for audio that leads TV, deterministic cancel and separate listener confirmation.
- Preserve delay during continuous playback; invalidate confirmation after a known gap, source change, suspension or history overrun. No claim to detect TV-only drift.
- Local bounded logs with source epochs, ordered requests and acknowledgments, actual applied changes, correction episodes and uncertainty markers. No audio or identifying telemetry uploads.
- Native phone sharing, copy and JSON download without login, server storage or configured recipient.
- Static HTTPS delivery; foreground phone testing remains required. No browser-security bypass.

## Verification boundary

Engine and controller tests exercise generated PCM and mock media APIs. Source HTTP/CORS probes are transport checks. Neither proves audible phone playback, timing accuracy, actual sports rights coverage or successful share-sheet delivery. Real game observations are the next evidence needed.
