# Camera sync that starts quickly and survives breaks

Decision recorded September 10, 2026. This is the proposed architecture, not a claim that the current app implements it or that the missing timing input is available.

## Decision

Use camera observations to look up positions in a continuously prepared Duke radio timeline. Keep observing the TV during listening when unattended correction is wanted. Use recognized speech/events and acoustic matches as evidence for constructing or checking the timeline; do not make the viewer wait for a distinctive shared sound as the primary acquisition method.

For the personal prototype, a service on the Mac should receive, buffer and analyze radio independently of a camera session. The client plays that service's indexed audio. This avoids opening a separate radio connection whose advertisements or delay could differ from the indexed stream. A phone camera client is a later integration; the current server is accessible only on this Mac.

The decisive unsolved component is a sufficiently accurate, timely **game clock to radio sample map**. Moving the existing speech recognizer into a service does not by itself create that map. Prove its coverage and accuracy before presenting another automatic matcher as the solution.

## What Homestream actually discloses

Its [privacy policy](https://homestream.app/privacy-policy/) describes on-device game-state recognition combined with live provider data. Its [App Store description](https://apps.apple.com/us/app/homestream/id6776515387) also names proprietary audio recognition. The [FAQ](https://homestream.app/faqs/) requires a visible, running clock for acquisition. These sources do not explain the radio indexing algorithm or unattended recovery from a viewer-specific TV delay change with the camera put away.

The [company's launch announcement](https://www.businesswire.com/news/home/20260825791337/en/Homestream-Launches-Perfectly-Syncing-Duke-Auburn-and-Georgia-Tech-Football-and-Basketballs-Radio-Calls-to-the-Live-TV-Broadcasts) confirms radio rights-holder partnerships, including Learfield for Duke. That establishes a relationship, not a verified timing-metadata interface. An advance radio index is our architecture inference, not a discovered account of their implementation.

## Two mappings, two kinds of drift

1. **Game state to radio media position.** Record game identity, period, clock run/stop/correction segment, radio stream epoch, media sample position, uncertainty, evidence source and when that evidence became available. Retain audio covering the supported TV delays. Radio reconnects, missing audio and different ad insertions require explicit discontinuities.
2. **The viewer's TV to that indexed media position.** Timestamp camera frames and identify the game, period and a short sequence of clock changes. Find the corresponding indexed interval, then account for time since capture and audio output latency before seeking.

An incoming feed timestamp is not necessarily an event timestamp. A spoken clock timestamp is the time the words were said, not necessarily the time being described. A score update arriving at 8:15:30 does not prove which radio sample represents that play.

A radio index can remain valid while this TV gains five seconds of delay. Conversely, the TV can remain stable while radio reconnects. Handle those separately. Never repair a media discontinuity merely by assigning the new samples the current wall time. Start a new epoch and reacquire its relationship to the game; retain valid old buffered history under its original epoch.

An older anchor can still support playback if continuity and recent observations support it. Age alone is not a guarantee or a reason to discard it. Confidence must account for fresh TV evidence, current index coverage, competing candidates and discontinuities.

## Obtaining the radio map

Preferred input order, with prerequisites kept explicit:

| Candidate | What it contributes | What must still be established |
| --- | --- | --- |
| Radio source with synchronized game-clock metadata | Direct clock-to-media anchors | No such Duke interface has been verified. Confirm actual sample/timebase semantics, coverage and discontinuities. |
| Timestamped clock transitions plus independently calibrated radio timing | Clock start/stop/reset history and a separate bridge to audio | Need both inputs. A timing feed alone does not measure radio production delay. Calibration must survive source changes. |
| Reference game video plus OCR and independently verified TV/radio anchors | Dense clock history in reference video; shared PA/events can bridge to radio | Requires an accessible reference feed and successful cross-program alignment. Reference video latency and edits are additional state. The Tulane file supports offline experiments, not a live service. |
| Public play-by-play plus continuously recognized radio events/clock statements | Candidate play identity and coarse timing constraints using inputs closer to those already available | Sparse commentary, narrative lag and missing clock transitions may leave no accurate match. This is the practical no-paid-feed experiment, not an established production solution. |
| TV/radio sound matching alone | Precise anchors when a distinctive signal is actually shared | Ordinary-play coverage, false matches and room capture remain unproven. Keep as a supporting experiment. |

[Genius Sports](https://www.geniussports.com/data-capture/) describes direct scoreboard capture products; personal access and suitable Duke timing data are unverified. [Sportradar's NCAA football event feed](https://developer.sportradar.com/football/reference/ncaafb-push-events) documents play clocks and wall-clock fields, and expected data latency buckets of 2, 10, 25 and 50 seconds. It does not establish a continuous NCAA clock stream synchronized to our radio. Delivery delay affects whether an index is ready in time; timestamp accuracy is a separate property. Do not substitute NFL-only clock products as evidence of NCAA availability.

For the public-data experiment, match several distinctive plays in sequence, using period, possession, down/distance, score and player/event descriptions when available. Associate each radio phrase with an interval of possible event times, allowing measured narrative lag. Clock mentions narrow that interval; they are not exact timecodes. A game clock that stops can represent many seconds of media. Do not interpolate through unknown stops or carry a single delay across an edit.

Same-feed fingerprinting could identify a client position within our own radio archive if needed. It does not create the game-clock map and is different from comparing TV commentators with radio commentators. Playing the already indexed service audio makes this extra identification step largely unnecessary.

## Fast acquisition

- Begin receiving and indexing when game coverage starts, before the viewer presses Sync. Keep sufficient shared audio history for late joins; preloading a model alone is insufficient.
- A warm client submits a few timestamped running-clock observations and looks up an existing match. It should not wait for the next spoken clock or referee announcement.
- Proposed acceptance target: a reliable match within five seconds of a clearly visible running scoreboard when the matching audio and index already exist. This is a target, not measured performance. Report cold starts and unavailable coverage separately, rather than excluding them from the user experience.
- At the very beginning of a game, the required game evidence may not exist yet. Show that limitation. Starting unaligned audio with last game's delay does not satisfy early synchronized listening and can reveal plays early.
- Indexing latency must fit inside the TV's actual lead over our inputs. A pregame service removes initialization delay but cannot make a slow speech recognizer or delayed data feed know future events.
- If the desired audio has not arrived, explain that TV must be paused. More radio buffering cannot make late radio arrive sooner.

## Staying aligned

For unattended operation, leave the camera with a view of the scoreboard. Sample continuously at a measured affordable rate; increase sampling around clock changes and suspected returns from breaks. Maintain capture timestamps, not just OCR completion times.

Use these states: acquiring, aligned with recent observations, awaiting fresh evidence, and unable to match. A hidden or stopped clock is not grounds for inventing an offset. Preserve the last playback setting during an uncertain interval, but stop claiming it has been freshly verified. When live clock movement returns, look up the new indexed position and require agreement over several observations before correcting it.

Do not seek merely because an advertisement is detected. TV and radio breaks may differ without changing their subsequent game alignment. Replays, score graphics, camera movement and official clock corrections also need handling. Period/score/monotonicity checks help but cannot establish that a picture is live; replay detection remains fallible.

Apply confirmed large corrections at a suitable point and use a tested, bounded method for small drift. Add hysteresis so noisy measurements do not produce repeated audible jumps. Preserve an explicit user fine-adjustment bias until reset; do not immediately undo it with the next automatic update. Revalidate output timing when the audio device changes.

With the camera put away, muted TV and no player integration, a TV-only latency jump is unobservable to the app. Offer a brief re-scan in that mode. Backend radio analysis can continue, but cannot justify a claim of hands-free TV correction. Knowing the provider's name does not remove this constraint.

## Evidence and next acceptance work

The [paired Tulane experiment](output/acoustic-test/README.md) establishes one strong shared referee event and promising ordinary-play candidates. A ten-second ordinary-play query had near-tied peaks about thirteen seconds apart. A twenty-second query performed better locally. These overlapping trials do not prove rapid, reliable acquisition. No room microphone was involved.

Commercials were removed from the TV file. Annotate independent uninterrupted segments; never treat file-position differences as live broadcast delays. A cut is useful for testing reacquisition but cannot measure what ESPN's original commercial return actually did.

1. **Timing input feasibility.** Verify an accessible clock/timebase input or measure the public-data candidate's actual coverage. For every proposed input, record clock start/stop/reset semantics, event versus delivery timestamps, radio calibration, freshness and Duke coverage. No purchase or external outreach has been performed.
2. **Full-game causal replay.** Build separate training and held-out sections with hand-checked event and clock-transition references spanning all quarters, including early play and every identified edit. Reference annotations evaluate the automatic index; supplying them to the indexer would test only playback plumbing. Measure anchor gaps in elapsed wall/media seconds, not game-clock minutes.
3. **User-facing performance.** At representative random join points, report time to first correct sync, percentage of time accurately aligned, timing error, incorrect automatic seeks and time spent unable to match. Count failed/no-match starts. Proposed targets are five-second warm acquisition and five-second reacquisition after usable clock/index evidence returns, with error within half a second during accepted alignment. These targets remain unvalidated; also report total elapsed recovery from the actual discontinuity so delayed evidence cannot hide a long outage.
4. **Discontinuities.** Inject known TV delays, pauses, rate drift and radio reconnects independently. Verify recovery, refusal of ambiguous matches, and no extrapolation across source epochs. No future audio, centered feature windows, future transcript or hand-labeled calibration may leak into the live candidate. Any deliberate manual calibration is a separately reported assisted baseline.
5. **Actual device validation.** After the index passes offline evaluation, test the real camera, audible seeks, sustained capture, Bluetooth/device changes and a live game with intact commercials. A microphone-assisted mode requires its own room test and an explicit UI choice.

Current app code remains experimental and unchanged by this architecture decision. Its recognition starts with Sync and stops after a successful seek. That behavior does not meet the updated requirements. See [BACKLOG.md](BACKLOG.md) for implementation and validation work.

## Independent consultation and dispositions

Claude Fable 5.1 at low effort supplied a substantive prompt-only planning consultation based on labeled summaries of code, tests and public sources. It did not inspect the source or run tests. Its proposal is input to this Codex decision, not approval of this document or a consensus result. The complete response and runtime provenance are retained under `output/sync-architecture-review/`.

| Finding/proposal | Codex disposition |
| --- | --- |
| Continuous radio processing and continued TV observation | Accepted into this design and backlog. |
| Align intervals of possible spoken-clock times instead of insisting on two running utterances | Accepted as a candidate experiment, not a proven map. Include narrative delay and unknown stops. A camera started now does not provide earlier TV history. |
| A plus/minus fifteen-second acoustic search removes the observed false peaks | Rejected: the competing Tulane peaks were about thirteen seconds apart. Narrowing helps only when independently justified and demonstrably excludes alternatives. |
| Start with the previous game's guessed delay; allow up to sixty seconds for a coarse match | Rejected as fulfillment of the user's fast synchronized-start requirement. Optional unaligned listening is a separate behavior. |
| Plus/minus 0.5 or 1.5 seconds accuracy and roughly one second of speech timing error | Unsupported as performance claims. Measure actual errors, including announcer lag. The half-second goal above is explicitly a proposed acceptance target. |
| One usable clock statement per two game-clock minutes is a feasibility gate | Replaced: game clocks stop. Measure elapsed-time coverage and time to a correct match across representative joins and returns. |
| Re-anchor audio to wall time after a gap | Rejected as sufficient repair. Create an epoch boundary and establish its relation to game time anew. |
| Monotonic period/score checks reject replays | Accepted only as partial screening; these signals cannot prove live video. |
| Same-feed fingerprinting is inapplicable | Too broad. It can locate our own radio in its archive, but does not align different TV/radio programs or supply the missing game clock. |
| Keep the full-game history, detect suspected breaks, slew small drift, expose lock quality | Accepted in principle, with bounded retention, independent break verification, tested playback corrections and simple user-facing states. Implementation is backlog work. |

The runtime's primary output was `claude-fable-5-1` (5,801 output tokens); ancillary `claude-haiku-4-5-20251001` produced 14. The subscription-plan meter was not included in the response. No claim of subscription cost or money charged is made.
