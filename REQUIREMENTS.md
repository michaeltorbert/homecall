# MyStream — Duke requirements

Build a personal Duke radio companion that automatically aligns its internet radio playback with a separately watched TV broadcast, using the camera to read the TV game clock. The user accepted whichever platform is easiest; a local web app was selected. No TV provider is required as an input.

Automatic alignment is core functionality. Manual delay controls alone do not satisfy the request. The app must play an actual Duke feed, associate a TV observation with a position in buffered radio audio, and apply the adjustment itself when sufficient evidence exists.

Homestream's [site](https://homestream.app/) and [FAQ](https://homestream.app/faqs/) describe game selection, camera synchronization using a running scoreboard, fine timing adjustments, and device/speaker playback. Its proprietary matching algorithm is unknown.

## Acceptance

- Discover and play official Duke broadcasts with live coverage and recordings distinguished.
- Read the TV clock and period without depending on YouTube TV or another provider.
- Establish the radio game-clock position independently of the TV; reject missing/conflicting radio periods and ambiguous matches.
- Buffer audio and automatically seek the estimated position, accounting for recognition delay and output timing.
- Start synchronized listening promptly, including early in the game and when joining an already-running game. Prepare radio history and timing evidence before a camera request; waiting for a rare shared sound or two new spoken clock references is not an acceptable primary workflow.
- Keep synchronization under observation throughout listening and recover from TV delay changes after commercial breaks, pauses and gradual drift. Track radio discontinuities separately. A fixed initial offset does not satisfy this requirement.
- Support ongoing camera visibility for unattended TV correction. If the camera is put away and no other TV observation is available, explain that a fresh scan is needed to detect TV-only changes.
- Retain uncertainty around stopped clocks, replays, missing timing evidence and ad returns. Do not apply an unverified correction or describe a guessed delay as synchronized playback.
- Explain when audio is behind TV or a match lacks sufficient evidence.
- Provide fine adjustments, source switching, and reliable cancellation.
- Measure real audiovisual accuracy with independent paired-game evidence before claiming reliable Homestream-like synchronization.

The automatic implementation is experimental. Public Duke audio, local transcription, synthetic-scoreboard OCR, component tests, and the production build have been checked. Paired Tulane recordings establish some acoustic correspondences, but reliable live TV alignment and browser/media interaction remain unverified. The current implementation starts recognition at Sync and stops it after a match, so it does not meet the startup and ongoing-recovery requirements. See the proposed [sync design](SYNC-DESIGN.md), [README.md](README.md) and [BACKLOG.md](BACKLOG.md).
