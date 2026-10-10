# Broadcast schedule findings (issue #32, Phase 0)

Research recorded 2026-10-10. For each Homecall school, this file records what the broadcaster publishes about upcoming broadcasts, field by field. A bounded Duke-only countdown was then built on the verified Duke contract (see **Implemented Duke scope**); the research sections below are kept as recorded. **Issue #32 is not complete**: every school other than Duke is unverified, and device, deployed and real-provider behavior are unproven (see the final section).

This file contains no addresses: no provider hosts, feed or script paths, query strings, raw XML or private configuration values. The raw evidence is kept outside the repository and is cited here by evidence ID and content hash. Repository paths are cited as code provenance.

## Method and limits

- **Duke.** At 2026-10-10T21:28Z the coordinator made unauthenticated GET requests for three things: the official Duke player page, the public script the page links, and the live schedule feed the page names. All three returned HTTP 200.
  - No audio, stream or media address was requested.
  - The coordinator confirmed in the raw page that a "NEXT BROADCAST" heading was displayed. This file treats that as relayed evidence.
  - The author read only the redacted feed and the script excerpts, did not repeat any Duke request, and did not see cookies or signed addresses.
- **Other schools.** The author made at most one metadata-only page read per official host. Only public pages already named in `src/teams.js` and `lib/archive-source.mjs` were used. Pages that returned no usable content were recorded as such and not retried.
- **Not read.** By rule, the private catalog and Homestream provider data were not read. Homestream schools are therefore **unverified (access-limited)**, which is different from unsupported.
- **Single observation.** One observation cannot establish how often a provider updates its data. A client's request interval is also not a provider guarantee of update frequency.

### Evidence index (external, `research/broadcast-countdown-2026-10-10/`)

| ID | Item | SHA-256 (raw bytes) | Notes |
|---|---|---|---|
| E1 | Duke official player HTML, 21:28Z | `152a21ff58b22d73f61c268c9fb251f6fbd3c212629924cc2040192e0ce71378` | Not read by the author. The coordinator verified two things in this page: the "NEXT BROADCAST" heading, and that the `live` entry of the feed-address map carries an expiry and signature query. Queries are redacted everywhere. |
| E2 | Duke player public script, 21:28Z | `64f1cf38408ad6c940ae6d8acd2656c4f8111020d605768b8d0c894e477b947c` | Read through address-free excerpts (`duke-js-excerpts.txt`), including the time conversion and refresh snippets. |
| E3 | Duke live schedule feed, 21:28Z | `08bc2607bfa2380e09ae6eb21888eaf52138d891c0d4681aa3822ddd11e83b87` | Read through the full redacted copy (`duke-live-redacted.xml`), with each event's media `url` redacted. |
| W1 | Georgia Tech official radio page | — | Author session, 2026-10-10. Text only. |
| W2 | Virginia Tech Sports Network official page | — | Author session, 2026-10-10. Text only. |
| W3 | Miami official football radio affiliates page | — | Author session, 2026-10-10. Text only. |
| W4 | WQAM station page | — | 2026-10-10. No readable content. Not retried. |
| W5 | Duke official football schedule page | — | 2026-10-10. Returned only a title, so it has no kickoff data. Not retried. |

Exact UTC times of W1–W5 were not captured beyond the date.

## Summary by school

| School | Homecall source type | Broadcaster schedule observed? | Broadcast-start evidence | Status |
|---|---|---|---|---|
| Duke | Network (official LeanStream-style player); also has a Homestream catalog ID | **Yes.** A live feed lists current and upcoming events (E3) | The official player's script binds its next-broadcast countdown to `start_timestamp` (E2), under the confirmed "NEXT BROADCAST" heading (E1) | **Usable contract candidate.** Open evidence items are listed below |
| Georgia Tech | Homestream discovery | No public absolute schedule. The official page gives only a relative rule (W1) | None. The page states pregame relative to kickoff, and the issue forbids deriving broadcast start from kickoff | Unverified (access-limited) |
| Virginia Tech | Network (LeanStream-style) with an archive feed | Not observed. The official page gives only relative rules (W2) | None | Unverified; plausible lead |
| Miami | Network only (WQAM station stream) | Not on the official affiliates page (W3). The station page was unreadable (W4) | None | Unverified |
| Auburn | Catalog only (Homestream) | No configured official page; not researched | None | Unverified (access-limited) |
| Virginia | Catalog only (Homestream) | No configured official page; not researched | None | Unverified (access-limited) |
| Other catalog schools (dynamic) | Homestream catalog, listed at runtime | Not researched; the catalog is private | None | Unknown by default |

No school has been shown to be **unsupported**, that is, shown to have no broadcaster schedule. Every school other than Duke is unverified.

## Duke: field-level findings

### Feed structure (E3)

The root element is `<main>`. It holds:

- `<sports>`: a table of `<sport>` entries, each with `id`, `name` and `is_show`;
- `<events>`: holds `<current_ev>` and `<upcoming_ev>`, each a list of `<event>` entries.

The fields of each `<event>`:

| Field | Observed form | Notes |
|---|---|---|
| `id` | Integer | Event identity. |
| `start_timestamp` | Epoch seconds | The official countdown's target (see the binding section). |
| `start` | `YYYY-MM-DD HH:MM:SS`, no zone | In all 16 rows it equals `start_timestamp` read as UTC. This is consistent within one observation, not documented. |
| `end` | `YYYY-MM-DD HH:MM:SS`, no zone | Not documented. The repository assumes it is UTC (`lib/duke-source.mjs:57`, `:96`), and that assumption is untested. |
| `sport_id` | A key into the sports table | Identifies the sport or show. |
| `opponent` | Text | An empty element in every show row. May have trailing whitespace in the raw feed (`UNC `). |
| `url` | Redacted | Media address. A schedule feature must never request or return it. |

The script also reads an optional per-event `custom_title`, which overrides the sport name. No observed row had one.

The observed sports table:

| ID | Name | `is_show` |
|---|---|---|
| 1 | Football | 0 |
| 2 | Men's Basketball | 0 |
| 3 | Women's Basketball | 0 |
| 112 | Duke Basketball Radio Show | 1 |
| 419 | Countdown to Craziness | 1 |
| 530 | Duke Women's Basketball Show | 1 |
| 898 | Duke Football Radio Show | 1 |
| 1256 | Fast Break with Jon Scheyer | 1 |
| 1280 | The Duke Womens Basketball Countdown to Tipoff | 1 |
| 1459 | Duke Spring Football Radio Show | 1 |
| 1708 | Duke Womens Basketball Show | 1 |
| 1834 | NCAA Countdown to Tip-Off Show | 1 |

Before Phase 0, the repository assumed only the 1/2/3 mapping. The basketball names in the feed use a typographic apostrophe.

**Contents at 21:28Z:**

- **Current:** 1 event. Football vs Georgia Tech, 2026-10-10 18:00Z to 2026-10-11 03:00Z (a 9-hour window).
- **Upcoming:** 15 events through 2026-11-19, listed in ascending start order:
  - 6 football games;
  - 2 men's basketball games;
  - 7 shows (sport IDs 898 and 112).
- **Next upcoming event:** the Duke Football Radio Show, 2026-10-13 23:00Z.

### How the official player binds `start_timestamp` to its countdown (E2, with the E1 heading)

The script's event loader reads the `live` entry of the page's feed-address map, then:

1. **Sport names.** It builds a name for each sport ID from the sports table. A `custom_title` overrides it.
2. **Late starts.** Any upcoming event whose `start_timestamp` is earlier than the browser's current epoch second is moved into the current list.
3. **Countdown.** If no current event is shown, it takes the **first upcoming event in document order**, not a sorted order. It renders that event's countdown element with `data-jsdate` set to `convertToLocalTimezone(start_timestamp, "js_date")`, plus the sport name (or `custom_title`) and the `opponent`. The coordinator confirmed that this content sits under the "NEXT BROADCAST" heading.
4. **Time conversion.** `convertToLocalTimezone` multiplies `parseInt(start_timestamp)` by 1000, makes a `Date`, and formats it with moment in **the browser's local zone**. The `js_date` format is `"YYYY, MM, DD, HH, m, 0"`; display formats append a zone abbreviation. The input is absolute, so the target instant does not depend on any zone the publisher used.
5. **Ticking.** A countdown widget redraws about once a second. The excerpts do not show how the widget parses the `js_date` string, or whether the player sets the widget's `serverSync` or `timezone` options.

**Verdict.** This meets the agreed proof bar for Duke. The provider's own public script, under its own "NEXT BROADCAST" heading, counts down to `start_timestamp`. That is the publisher's broadcast-start semantics, not an inference from a field name.

**Caveats:**

- The official "next broadcast" includes shows as well as games.
- The official player hides its countdown while an event is current.
- No source-supported kickoff comparison was made. The official schedule page (W5) was unreadable, and kickoff is not needed for the field binding. Nothing here shows that `start_timestamp` equals kickoff, or that it differs from it.
- The original user observation ("in 17min 41sec · Football / Georgia Tech") would fit the Georgia Tech event if it was made around 17:42Z. Its time was not recorded, so it remains unverified.

### Request cadence of the official player (E2) is not a provider guarantee

- **Non-live state.** After a successful load, the script schedules another load **60 seconds** later, except on the past-events and classics views. Each cycle also refreshes the feed-address map from the provider unless told not to.
- **Live-radio state.** When the live-radio element is present, the script also reloads after 60 seconds.
- **Autoplay branch.** One branch reloads after 2 seconds.
- **Errors.** The error handler is empty. In the excerpts, a failed load schedules no further load.

This is how often **this client asks**. It does not establish how often the **provider updates** the feed. **Provider update cadence: unknown.** HTTP cache headers were not part of the relayed evidence.

The feed address itself is time-limited:

- **Signed.** The `live` entry in the 21:28Z page carries an expiry and signature query (E1, coordinator-verified).
- **Refreshed.** The player refreshes the address map on every cycle.
- **Unknown.** How long a signed address stays valid, and when or how it rotates.

### Time zones and DST

- `start_timestamp` is absolute, so the countdown needs no zone interpretation.
- The `start` text matched UTC in all 16 rows. `end` has no zone; reading it as UTC is still an assumption. A countdown should not depend on either text field.
- Wall-clock times look like Eastern-local entries converted to UTC. The weekly Football Radio Show sits at 23:00Z before standard time resumes on 2026-11-01 and at 00:00Z after it, which is 7 p.m. Eastern both times. This is inference and is not needed for the countdown.

### Placeholder or uncertain times

Three upcoming football rows have one-hour windows at 4:00 a.m. Eastern:

| Opponent | Start (UTC) | End (UTC) |
|---|---|---|
| Boston College | 2026-10-31 08:00 | 09:00 |
| NC State | 2026-11-07 09:00 | 10:00 |
| Miami | 2026-11-14 09:00 | 10:00 |

The confirmed game rows have windows of 8.5 to 9 hours. These three look like times still to be announced, but **no field marks a time as tentative**, and the official player would count down to them unchanged.

Agreed product policy: uncertain placeholders produce an **unknown** state, not a countdown. The rule for *identifying* an uncertain row has no field-level evidence; it would be an explicit, tested heuristic, which is an open item.

### Empty upcoming list

An empty `upcoming_ev` was not observed. The script treats a missing or empty section as having no events.

Agreed meaning: a successful, structurally valid feed with an empty `upcoming_ev` means only "no upcoming broadcast **listed by this provider**". It is not proof that no future event exists. The observed list covered about 5.5 weeks, so the provider's coverage window is unknown. A failed, partial or malformed read never means "none".

## Other schools

- **Georgia Tech** (Homestream discovery).
  - The official radio page (W1) says "Pregame starts 2 hours prior to kickoff" for football. That rule is relative to kickoff, so it is excluded: the issue forbids deriving broadcast start from kickoff. The page shows no absolute schedule or countdown.
  - Homecall's `normalizeGames` (`lib/homestream-catalog.mjs:13`) produces a generic `start` from `date`/`time`, but only when the timezone is UTC. Nothing in the repository says whether that is broadcast start or kickoff.
  - Provider data is private and was not inspected.
  - **Unverified (access-limited).** No countdown may use either source.
- **Virginia Tech.**
  - The official network page (W2) gives only relative rules: the "Kickoff Show airs two hours prior to kickoff", and coverage "continues 30 minutes prior to kickoff". These are excluded for the same reason.
  - Homecall's source ID is `vt-leanstream`. The VT archive parser (`lib/archive-source.mjs:17–78`) reads the same shape as Duke's feed from a privately configured JSON feed: a sports table with `is_show`, `previous_ev`/`archived_ev`, and `start_timestamp`.
  - An upcoming-events feed like Duke's is plausible, but it was not observed, and no public VT player page is configured to read it from.
  - **Unverified.**
- **Miami.**
  - Homecall plays the WQAM station stream.
  - The official affiliates page (W3) is a station directory with no schedule. The station page (W4) was unreadable.
  - A station program grid, if one exists, would describe station programming rather than game coverage.
  - **Unverified.**
- **Auburn and Virginia.**
  - Both are catalog-only, with no configured official page, so nothing public was read.
  - Virginia Tech must never resolve to Virginia (`src/teams.js:7`).
  - **Unverified (access-limited).**
- **Dynamic catalog schools.**
  - Schools listed at runtime were not researched, and their capability is unknown.
  - Until evidence exists they get no countdown, with neutral wording. That treatment does not mean they were found to be unsupported.
- **Duke backup and affiliate stations** (`src/teams.js:21–26`).
  - These are station streams, not schedule sources.
  - The Duke schedule describes the Duke network, not what an affiliate is airing.

## Repository-side findings

1. **An unused reader exists.** `fetchDukeSchedule` (`lib/duke-source.mjs:110–124`) works like this:
   - It reads the player HTML and extracts the `event_xml_urls` block.
   - It requires the `live` and `previous` addresses to have the player's origin and exact configured paths (`liveFeedPath`, `archiveFeedPath`).
   - It rejects any address that has a query string (`:119`).

   Nothing calls it; `PRIVATE-STREAMS.md:26` only mentions it.

   The observed `live` entry carries a signed query (E1), so as written this reader would fail closed against the 21:28Z page and could not read the current live feed. The archive reader (`lib/archive-source.mjs:156–157`) checks origin, path and credentials but not the query.
2. **The live parse loses information** (`parseEvents(xml,'live')`, `lib/duke-source.mjs:89–108`):
   - It silently drops these rows: rows with no `url` or one that fails the audio policy; rows with any other sport ID, which includes every show; and malformed rows.
   - It removes duplicate IDs without checking whether they conflict.
   - It returns media URLs.
   - It ignores the sports table, `is_show` and `custom_title`.

   An empty result therefore cannot mean "no upcoming broadcast". Strict parsing is archive-only (`:85–87`), and strict live parsing is rejected (`test/duke-source.test.js:98`). The only live test (`:6–10`) covers expired current events.
3. **Whitespace trimming happens before validation.** A raw value like `UNC ` is normalized, not rejected:
   - `labelOK` (`lib/duke-source.mjs:20`), applied to untrimmed text, would reject it, because it requires `trim() === value`.
   - The strict archive pipeline never gives `labelOK` untrimmed text. `strictField` returns `decode(...)` (`:31`), and `decode` ends with `.trim()` (`:13`). So `opponent` reaches `labelOK` (`:58–59`) already trimmed.
   - The lossy `field` helper (`:15`) also trims, through `decode`.

   A new live parser should reuse that decode-and-trim step, or state its own trimming explicitly. It should not call `labelOK` on raw text.
4. **Configuration is a dependency, and the design is unresolved.**
   - `PRIVATE-STREAMS.md:15` documents `archiveConfig.dukePlayer` and an exact `dukeFeedPath`, which is used for `previous` (`lib/archive-source.mjs:152–157`). It documents no live-feed path.
   - `fetchDukeSchedule` expects `liveFeedPath`. Whether the deployed private configuration contains any live-feed value is unknown and was not inspected.
   - **Option A:** add a private key for the exact live-feed path. That needs a private catalog change, which is outside this phase.
   - **Option B:** reuse the existing `dukePlayer`, and accept only a `live` address that the page advertises, on strictly the same origin. Validation would be backend-only: HTTPS only; no credentials, port or fragment; the signed query handled and never logged or returned; a bounded size and timeout.

   Option B might avoid a new private upload. Its safety, compared with pinning an exact path, has not been evaluated. **Which option to use is a design checkpoint**; neither has been shown to be required.

   *Superseded by the implementation:* Option B was chosen and Option A deferred. See **Implemented Duke scope**.
5. **Gateway and Worker surfaces.**
   - Routes and cache lifetimes are listed in `lib/metadata-gateway.mjs:8–15`.
   - Age accounting covers only `AGED_ROUTE` (`:16`, `:58–63`).
   - `worker/index.mjs:22` lists `allowedFamilies` for diagnostics.
   - The Worker loads the private catalog only for `/api/homestream/` (`:16–17`).
   - A schedule route that needs `archiveConfig` touches these, plus the path check in `src/gateway.js` `metadataURL`. (*Corrected:* `server.mjs` needs no change, because it already delegates every `/api/` request to the Worker.)
6. **Game status is separate.** `src/game-status.js` holds the source-reported states live, upcoming, completed and unknown.
   - Broadcast schedule data must not feed game status, and game status must not feed a countdown.
   - The official player's rule that "past start means current" must not become a live signal in Homecall.
   - The existing wording at `src/app.js:270–271` stays: "does not prove the game is on air", and "an empty or expired schedule does not disable this channel".
7. **The backlog already names these risks.**
   - SOURCES-01 (`BACKLOG.md:14`): validate naive time-zone fields against publisher semantics.
   - NOW-PLAYING-03 (`BACKLOG.md:92`): never guess a radio-to-game association from kickoff time.

## Agreed product policy for the Duke countdown

These are product rules and proposed local settings, not provider facts.

- **What counts.** "Next broadcast" includes shows, as the official player does. The label is the sports-table name (or `custom_title`), plus the opponent when it is not empty.
- **During a current event.** While an event is current, or while a stream is playing, Homecall still shows the next *upcoming* broadcast. This is independent of game status and playback state.
- **Placeholders.** Uncertain or placeholder times produce unknown, not a countdown. The implemented identification rule is a local heuristic: see **Implemented Duke scope**.
- **Empty list.** An empty listing reads "No upcoming broadcast listed", never "no future event".
- **At zero.** Neutral wording only. No "LIVE", no claim that audio has started, and no change to game status.
- **Proposed local timing** (not provider guarantees):
  - server refresh: 60 seconds;
  - server cache lifetime: 60 seconds;
  - maximum accepted data age: 300 seconds;
  - after that, unknown. A stale countdown is never shown.

## Concrete unresolved evidence

1. **Placeholder rule.** No field flags tentative times. The implemented overnight heuristic is an agreed local policy, not provider semantics: it can hide a real overnight broadcast, and it cannot catch a placeholder at or after 07:00 Eastern.
2. **Signed live address.** The `live` entry carries an expiry and signature query (E1). How long it stays valid is unknown, as is how and when it rotates, including whether each address-map refresh changes it. Backend handling must keep the query out of errors, logs and responses.
3. **Configuration.** Option B is implemented. Whether the deployed `archiveConfig.dukePlayer` is present, and in the canonical form the adapter requires, is uninspected.
4. **Provider freshness.** Update cadence and HTTP caching are unknown. A second, later observation would show only that the data changed between those two points, not a cadence.
5. **Coverage window and empty form.** The coverage window is unknown, and no empty `upcoming_ev` has been observed.
6. **Document order.** The provider counts down to the first upcoming row in document order. The observed feed was sorted, but whether it is always sorted is unknown.
7. **Countdown widget.** How the widget parses the `js_date` string, and whether `serverSync` is set, is not shown. This does not affect Homecall, which should use `start_timestamp` directly.
8. **The `end` field.** Its zone is unproven. Homecall's countdown should not need it.
9. **Every school except Duke.** Georgia Tech, Virginia Tech, Miami, Auburn, Virginia and the dynamic schools are unverified. A Virginia Tech upcoming feed is the most plausible next lead.

## Implemented Duke scope

This supersedes the research-phase proposal. It is bounded to Duke. It is not proof of real-provider, deployed or device behavior.

**Route and configuration (Option B).**
- **Route.** The gateway route `/api/broadcast/schedule/duke` (client path `broadcast/schedule/duke`) is served by `lib/broadcast-schedule.mjs`.
- **Configuration.** The route reads only the existing private `archiveConfig.dukePlayer`. No new private key was added, and no catalog upload is needed.
- **Missing configuration.** A missing, non-canonical, `http:`, query-bearing, port-bearing or credential-bearing player value makes the route unavailable, and the client shows unknown.
- **Worker.** The Worker loads the private catalog for this exact route only, and reports the diagnostics family `api/broadcast/schedule`. `server.mjs` is unchanged.

**Provider requests.**
- **Two requests per cache miss.** The server fetches the player page, then the live feed the page advertises. It never requests an event media address.
- **Request settings.** Both requests share one 8-second aggregate deadline combined with the caller's abort. Each is capped at 2 MiB, and each is sent with no credentials, no cache and manual redirects. A redirect response is rejected.
- **Accepted live address.** The page must contain exactly one `event_xml_urls` map with exactly one literal `live` string. That string is checked as raw text before URL parsing. It must:
  - be HTTPS on the configured player's exact origin;
  - carry no credentials, port or fragment;
  - contain no backslash escapes, HTML entities or whitespace;
  - have no dot segments;
  - not be the player path or the archive feed path;
  - be canonical.

  An ordinary `&` between query parameters is allowed. The signed query is used only in the transient backend request.
- **What never leaves the backend.** Thrown errors and diagnostics carry fixed text and step names only. The page, feed, address and query are never logged, cached or returned.

**Parser.**
- **Structure.** Validation is strict and covers the whole feed:
  - one optional leading XML declaration;
  - no DTD, entity declaration, comment or later processing instruction;
  - exactly one `<main>`, `<sports>`, `<events>` and `<upcoming_ev>`, with an optional `<current_ev>`;
  - rows made of flat leaves only.
- **Unknown leaves.** Leaves such as the media `url` and the naive `start`/`end` text are tolerated and never read.
- **Required fields.** Each required field is checked explicitly:
  - event `id`;
  - `start_timestamp` (1–12 digits, positive, safe in milliseconds);
  - a numeric `sport_id` that appears in the sports table;
  - sport `id`, `name` and `is_show`.

  `opponent` may be empty. A non-empty `custom_title` is validated. Labels are decoded and trimmed before validation.
- **Duplicates.** Identical duplicates coalesce. Conflicting duplicates, and any malformed row or mapping anywhere, make the whole result unknown.
- **Selection.** Rows are sorted by `start_timestamp`, then by ID. **Selection never depends on the server clock**: a row whose start has passed stays next until a provider snapshot moves or withdraws it.
- **Ties.** Different events at the earliest start time make the result unknown.
- **Overnight rule (local policy).** If the earliest event, game or show, starts between 00:00 and 06:59 `America/New_York`, the result is unknown. The rule uses `Intl` with the named zone, so DST is covered. It never estimates or rewrites a time. A later unconfirmed row does not block an earlier confirmed one.
- **Empty list.** A structurally valid empty `upcoming_ev` reads "No upcoming broadcast listed". A missing or malformed section is unknown.

**Response and freshness.**
- **Fields.** The response is `{schemaVersion: 1, school: 'duke', state, event?: {id, label, kind, broadcastStart}, reason?, checkedAt, ageMs}`.
- **Time and age.**
  - `checkedAt` is the epoch milliseconds at which the live feed was received.
  - `ageMs` follows the existing `representationAge` convention on the live feed's headers: a valid `Date` is required, and `Age` is optional. The player page's age is not used.
  - Without a valid `Date`, the age is unknown, and the client shows unknown.
- **Server cache.** Only the sanitized response is cached, for 60 seconds. Cache residence is added on every delivery. An expired entry is never served after a failure.

**Client** (`src/broadcast-countdown.js`). This is an independent controller wired from `src/app.js`.
- **When it runs.**
  - It starts after every committed school change, including startup and a confirmed change. A declined change keeps the old school.
  - It suspends while the page is hidden and resumes when it is visible again.
  - It ticks on the existing one-second visible ticker.
  - A source-only change does not touch it.
- **What it touches.** It writes only its own hidden-by-default line. It has no `aria-live` and no status role. It never calls Play, Sync, catalog refresh, media probes, game status or relabeling.
- **Which schools.** Only Duke has a path. Every other configured or catalog school stays hidden and makes no schedule request.
- **Countdown text.** The text reads "Duke network · Next broadcast starts in … (local time) · label". The "Duke network" provenance means a selected affiliate is never implied to carry the broadcast.
- **Polling and freshness.**
  - Polls run every 60 seconds while the page is visible, and never overlap.
  - Data is unknown once the server age plus the time since the request started reaches 300 seconds.
  - Any failure or invalid response replaces a shown countdown with unknown immediately.
  - A wall-clock jump that the monotonic clock does not share also gives unknown, followed by a refresh.
- **At zero.** The line reads "Scheduled broadcast start time reached for …. This does not confirm audio or game status." There is one extra refresh at zero and no loop.

**Tests.**
- **New test files.**
  - `test/broadcast-schedule.test.js` covers the parser, resolver, broker, bounds and leak checks.
  - `test/broadcast-countdown.test.js` covers the controller with fake clocks.
- **Extended tests.**
  - `test/gateway.test.js`: seven route families, cache and age, Worker boundary and diagnostics.
  - `test/app-recovery.test.js`: committed-school wiring and a non-disruption check during playback.
  - `test/node-gateway.test.js`: local delegation.
- **Worker script.** `scripts/test-worker.mjs` covers the route and the named time zone in local workerd.

All fixtures are synthetic.

**Not proved.** The live entry's real encoding, the feed's real `Date`/`Age` headers and the deployed configuration all need a coordinator-run metadata-only check before release. If any of them fails these rules, the feature shows unknown rather than a countdown. Workers `Intl` support is covered only in local workerd. No browser, device or production evidence exists here, and issue #30 phone checks stay open.

## Issue #32 status

Requested work:

- **Investigate first:** **partly done.** Duke is covered at field level, including its time-zone handling. Provider cadence is unknown. Every other school is unverified.
- **Build the countdown:** **Duke only, implemented as a bounded candidate.** Not reviewed, deployed or device-tested.

Acceptance criteria. "Candidate" means the item is implemented and covered by synthetic tests, pending independent review and real-provider checks.

| # | Criterion | Disposition |
|---|---|---|
| 1 | Findings documented: which schools have usable data, and which fields | **Partly met.** Duke's contract is documented. Every other row is explicitly unverified, not unsupported. |
| 2 | Countdown and event label for a known upcoming broadcast, without opening the official player | **Duke candidate.** Covers games and shows, including during a current event or playback. The overnight rule can deliberately show unknown instead. |
| 3 | Labeled as broadcast start; kickoff never presented as broadcast start | **Duke candidate.** Uses only `start_timestamp`, which the provider's own countdown uses. No kickoff, Homestream `start` or ESPN time is used. |
| 4 | Updates automatically; schedule refresh reflects changes | **Duke candidate.** 1-second ticks, 60-second polling and cache, 300-second maximum age. These are local policy; provider cadence is unknown. |
| 5 | Missing, ambiguous or stale times give unknown | **Duke candidate.** Covers malformed rows, ties, the overnight rule, unknown or stale age, failures and clock jumps. The overnight heuristic cannot catch every placeholder. |
| 6 | No countdown for schools without a broadcaster schedule | **Partial.** Non-Duke and dynamic schools show nothing and make no request. Their providers are unverified, not proven unsupported. |
| 7 | Clear message when there is no upcoming event | **Duke candidate.** "No upcoming broadcast listed" appears only for a valid empty listing. The provider's coverage window is unknown. |
| 8 | Zero proves neither audio nor a live game; game status stays separate (#10) | **Duke candidate.** Neutral wording at zero. No coupling to game status, Player or Sync. |
| 9 | No new browser-to-provider requests or exposed addresses; privacy, playback and manual sync preserved | **Duke candidate.** The browser reaches the gateway only. Leak tests cover output, cache, errors and diagnostics. Playback non-disruption is shown with fakes, not on a device. |
