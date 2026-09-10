# MyStream · Duke

A local web app that plays Duke radio and estimates alignment with a TV scoreboard seen by the camera. TV provider selection is unnecessary. This is experimental; Homestream-equivalent accuracy has **not** been established.

The [updated sync design](SYNC-DESIGN.md) calls for a prepared radio timeline, fast camera lookup and continued checking after commercial breaks. Those changes are planned, not implemented. Establishing an accurate radio-to-game-clock map is the next feasibility gate.

## Run

Requires Node.js 22.12+ or a compatible newer version.

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4178 on this computer. Select a Duke broadcast, start playback, then select **Sync with camera**. Include Duke's team label, the period, and a moving game clock in the picture. Recognition models download on first use; keep the page open while they load. Fine adjustments and manual timing are also available.

The server listens only on this computer. Phone installation, remote access, and background mobile playback are not implemented. Camera access requires a supported browser and permission. No account or API key is required.

## Implemented

- Fresh broadcast discovery from Duke's official player, with upcoming coverage and recordings distinguished. A stale `isLive` field alone never establishes on-air status.
- Direct Duke playback, three-minute stereo history, pause/resume, return to incoming audio, and 0.25/0.5/1/5-second adjustments.
- Camera scoreboard recognition with capture timestamps, period checks, and observed clock movement.
- Local radio speech recognition, timestamped clock extraction, radio-derived period association, and repeated-camera confirmation before a supported estimate changes playback.
- Rejection of conflicting periods, duplicate transcription windows, unsupported extrapolation, ambiguous matches, expired audio, and stale camera results. When the requested radio moment has not arrived, the app explains that TV must be paused.
- Camera and radio analysis stop after application, cancellation, manual timing changes, source changes, or a reported Duke playback stall.

Automatic matching covers regulation football and basketball. It requires enough clear, compatible clock and period references in the commentary. It may take a long time or find no match. Overtime is not supported.

Both matching references currently need explicit running-clock language. This conservative requirement limits coverage, particularly in basketball. The radio also needs enough lead over the TV for an audio window to finish and recognition to catch up; a small lead may prevent matching. The app offers pause-TV guidance when the TV has passed analyzed coverage. Recognition speed in a browser has not been measured.

## Accuracy and validation

The algorithm interpolates between two short, consistent running-clock utterances with the same radio-associated period. It uses the median timing offset across confirming camera readings and compensates for camera processing time and reported output latency while remaining inside the supported radio segment. Speech timestamps locate the announcer's words; they do not independently establish the physical game moment. Utterance agreement is **not** a measured audiovisual error bound. Announcer delay, recognition errors, unobserved stoppages, and a mismatched game can still produce an incorrect estimate.

`npm test` exercises buffering, parsing, period association, matching, latency direction, source parsing, and scan lifecycle. `npm run build` produces the browser bundle.

Two excerpts from the official September 5 Duke–Tulane recording were transcribed locally. The in-game excerpt supplied real clock candidates; it was not paired with independently timed TV video. A generated scoreboard was recognized with actual Tesseract OCR. These validate components, **not** live TV accuracy or camera performance in a room.

The in-game excerpt was additionally checked in 24 overlapping 20-second recognition windows, matching the app's window and hop sizes. The final window contains 0.0081875 seconds of silence padding at the excerpt end. Processing used native local inference, so this does not establish browser WASM speed. See `output/tulane-stream-windows.json` and `output/validation.json`.

Browser verification remains unavailable: the in-app browser refused access because its administrator-enforced security check could not be verified. No alternate browser or indirect access was used to circumvent that refusal. See [BACKLOG.md](BACKLOG.md) for remaining acceptance work.

## Data and dependencies

Audio history, recognition, and camera processing stay on the device. The app contacts Duke/Leanstream for schedules and audio, and public model/library hosts for recognition assets. Camera images and microphone audio are not uploaded; microphone access is never requested. Public transcript fixtures used in development are separate from the temporary playback buffer.

Dependency audit on September 10 reported three high-severity advisories in the Transformers native Node dependency chain through `onnxruntime-node` and `adm-zip`. The indicated patched `adm-zip` release was unavailable from the registry. The browser uses WASM; the outstanding advisory concerns native installer ZIP extraction. A `sharp` advisory was resolved with an override. The dependency audit is not clean.

## Primary sources

- [Duke's official player](https://duke.leanplayer.com/)
- [Duke radio listening information](https://goduke.com/sports/2022/8/6/local-radio-affiliates)
- [Homestream's feature description](https://homestream.app/faqs/)

Independent personal project; not affiliated with Duke, Learfield, or Homestream.

Local broadcast recordings, transcripts and review handoffs are excluded from the public repository. Two recording-dependent tests explicitly skip when those optional local fixtures are absent.
