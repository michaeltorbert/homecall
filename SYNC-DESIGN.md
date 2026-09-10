# Manual synchronization contract

`AudioHistory` retains stereo PCM for 180 seconds. `ManualEngine` owns all delay, pause and hold changes in the worklet thread. A relative command reads the current engine delay, so rapid taps accumulate. Each acknowledgment reports the before/after state; unavailable history clamps explicitly. Slider movement previews locally and commits an absolute delay on change.

The media element feeds the worklet through Web Audio. Known `waiting`/ended/error states gate incoming samples without treating legitimate silence as a gap. A network `stalled` notification gates only when the element lacks future data. These events are best-effort browser signals: they cannot expose every broadcaster ad splice or prove continuous original program content. Context interruptions invalidate listener confirmation and cancel any hold. Reconnect/team change creates a new context/engine epoch and discards all PCM; stale async callbacks and acknowledgments cannot update the replacement player.

## Two taps

Start only during incoming, unpaused playback. The engine snapshots the current delay and holds the exact next sample. Completion resumes that held position. Cancel restores the original delay relative to the current incoming edge. A gap, interruption or overrun cancels the hold and leaves playback paused. Position controls are disabled while holding. Completion is not an alignment measurement: the listener separately presses Sounds aligned.

Audio that already trails the picture requires the user to pause TV. Reducing delay skips forward, adding delay repeats content. No automatic TV-control integration exists.

## Evidence

A source sample count, AudioContext clock, monotonic page clock and UTC timestamp have different meanings. Logs keep them distinct. Requested adjustments and authoritative acknowledgments are separate events, bound by command ID and source epoch. Several adjustments before confirmation form one episode; interruption abandons an unconfirmed episode. A heartbeat records observed rendering conservatively, never credits a long unknown/background gap as confirmed observation, and does not prove anyone heard the audio or that TV remained aligned.

Only fixed identifiers, enumerated context and numeric/boolean timing fields enter generated logs. Export uses an explicit preview snapshot. Local storage is bounded and optional; copy/download remains available when persistence or native sharing fails. A reloaded page starts a new session; prior unclosed records retain uncertainty rather than fabricated end times.

## Future automation

Measure correction burden first. Shared arena sounds or camera-clock mapping may later help, but isolated sound matches, OCR clock reads and announcer timestamps are not demonstrated radio-media alignment. The original experiments remain in Git history. See BACKLOG.md for evidence gates.
