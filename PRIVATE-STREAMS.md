# Private stream gateway

The frontend contains public labels, stable source IDs, official attribution links and the gateway origin. Provider media addresses and discovery configuration live in the `STREAM_CATALOG` KV binding under `catalog`. The build never contacts a provider or emits an archive JSON file. Historical Git copies are outside this migration.

Public routes are `/api/catalog/live`, `/api/catalog/archive`, the existing Homestream metadata routes, and `/media/live/<id>`, `/media/archive/<school>/<id>`, `/media/game/<team>/<game>`. HLS playlists rewrite all supported resource references to authenticated AES-GCM capabilities. A game entry whose playlist has a plain filename answers with a one-variant master naming a directory capability, `/media/resource/<token>/<name>`; playlists served through that capability emit plain same-directory names unchanged, so a live playlist reloaded every second stays the provider's size and costs one regex per line rather than one seal. Names are limited to `[A-Za-z0-9_.-]` with no separators, so a capability never reaches outside its sealed directory; keys, query-signed or distant references keep exact per-resource capabilities. Provider filenames (not hosts or paths above the directory) are therefore visible in gateway URLs, and a holder of a directory capability can request any plain-named file in that upstream directory, subject to the content-type allowlist; narrow `allowedPaths` in the private catalog if a provider co-locates unrelated files. A playlist at an origin's root never receives a directory capability. The entry itself no longer contacts the provider, so a game entry's 200 or HEAD is not a liveness signal; the client probe and player judge the variant. The key is the Worker secret `MEDIA_TOKEN_KEY`, a canonical base64url encoding of 32 random bytes. Game capabilities last six hours so one broadcast never crosses an expiry; other capabilities last one hour. An expired or invalid capability answers 403 so players fail fast and reload the entry rather than retrying a provider-style 502; a player that outlives a capability reloads its original gateway root through bounded recovery. Unsupported playlist extensions/DRM fail visibly. Relaying conceals upstream addresses; it does not prevent recording or sharing the gateway audio.

## Private configuration

Keep the administrator's JSON in `.private/catalog.json` (ignored, permissions 0600) or an external private file. Never paste its contents into a PR, workflow, log or command argument. Validate before publishing with `node scripts/validate-private-catalog.mjs <file>`. Upload from the file with Wrangler `kv key put catalog --path <file> --binding STREAM_CATALOG --env preview --remote`. The CLI may print values with some commands; do not use a public terminal log for key reads. Provision the key through `wrangler secret put MEDIA_TOKEN_KEY --env preview` via stdin. Do not use a `VITE_` variable for private data.

The document has `schemaVersion: 1`, a bounded `version` policy identifier, `updatedAt`, and:

- `live`: source ID to `{url, allowedOrigins, kind: "audio"}`; each exact HTTPS origin, including any explicit port, is administrator approved. Optional `allowedPaths` narrows redirects/resources.
- `archive`: `checkedAt` and school records with legacy `source` (never projected; public attribution comes from the fixed public school map), `status`, original `checkedAt` and items `{id, opponent, sport, start, url, kind}`.
- `archiveConfig`: `dukePlayer`, exact `dukeFeedPath`, `vtFeed`, and per-school `replayRules` entries `{origin, pathPrefix, filenamePattern}`. Optional per-school `redirectOrigins` lists exact HTTPS origins a replay host may redirect a cold request to (Virginia Tech answers a recording's first request with a signed redirect); redirects elsewhere still fail closed. Like a live source's `allowedOrigins`, an approved redirect origin is trusted for any path and for up to four hops among that school's approved origins; approving one is an administrator decision about that host, not about one recording.
- `discovery`: `homestreamBase` and exact `mediaOrigins` approved from provider discovery. Newly introduced CDN origins fail closed until reviewed and configured.

Change `version` to revoke resource capabilities after a policy change. Routine archive refresh keeps it stable. KV is eventually consistent; revocation may take propagation time. Public handlers never write KV. Successful unsigned game resolutions have a bounded 15-second in-memory cache; expired entries are not served on failure. KV is read on every request; a byte-identical document reuses its validated parse, so no policy change is ever served stale. The Worker has a single configured six-hour schedule (`17 */6 * * *`), enabled only with `ENABLE_CATALOG_REFRESH=true`. Overlap is not excluded: duplicate delivery, a slow run meeting the next one, or an administrative upload can interleave, and KV provides no atomic lock or compare-and-swap. Each run makes at most one write, with a two-minute source-work deadline and 5 MB document limit. That deadline bounds source fetches, not the final KV read/write or the end of an old invocation. See **Archive refresh and recovery** below.

## Archive refresh and recovery

Each run reads and validates the stored document first. A missing or invalid document fails closed: no source request and no write. The first deployment therefore needs an administrator-provisioned catalog; the refresh never bootstraps or salvages one.

Per school (Duke, Virginia Tech), inside that school's own attempt:

- **Strict parse.** The refresh, and only the refresh, passes `{strict: true}` as the fifth `fetchArchive` argument. `createCatalog`, `fetchDukeSchedule`, live parsing and default parser calls keep their existing behavior.
- **What strict mode ignores.** A strict parse still ignores rows that are not eligible recordings:
  - rows with no advertised recording address (field absent, empty, or an empty/self-closing element);
  - Duke rows whose explicit, well-formed sport ID is unsupported;
  - rows with a valid future start.
- **What strict mode rejects.** An eligible past recording is rejected if:
  - its identity, start, Duke end, sport (a missing or malformed Duke sport ID; a VT sport-table miss) or labels are missing or malformed;
  - any advertised address fails the school's replay rules (a rejected address never falls back to the other field);
  - it conflicts with a duplicate ID (identical duplicates collapse);
  - it sits in a recognized but malformed section, event or field (repeated, attributed or unclosed tags, wrong JSON collection types).

  The feed itself must also be recognized. Duke needs a `previous_ev` or `archived_ev` element. Inside each such section only complete `<event>` blocks and whitespace are allowed, so a renamed event element or other leftover content is structural rather than an empty or partial list. VT needs an own `previous_ev` or `archived_ev` member, and a non-empty section needs its own `event` member. A missing or renamed container is structural, never an empty success. Empty forms count only inside a recognized section.

  One rejected row fails that school's whole result, with one reviewed exception below.
- **Reviewed source exclusions (explicit exception to the rule above).** The 2026-10-07 strict probe found one row per school, neither in retained history, whose two advertised addresses use the approved HTTPS origin and path but fail only the filename rule. Under the blanket rule, those two rows alone would have frozen both schools' lists (89 and 235 approved recordings) indefinitely. `lib/archive-source.mjs` therefore hardcodes one SHA-256 digest per school for exactly those full rows. Duke hashes the exact inner `<event>` XML; VT hashes `JSON.stringify` of the recursively key-sorted original event object, both as UTF-8. A row is excluded only if it:
  - passed every other row, label, date and structure check;
  - has every advertised address rejected (a mixed valid/rejected pair still fails);
  - advertises both addresses, and each is a filename-only rejection: clean HTTPS, an approved origin and path prefix, a plain `.mp3` name;
  - has an ID that is not in the school's currently retained list;
  - matches its school's reviewed digest exactly. Any change to the row, its addresses or its shape no longer matches.

  Further rules:
  - Excluded rows are counted as `sourceExcluded`, are never published, and never appear in logs or diagnostics beyond that count.
  - If a school's result would contain only excluded rows and no approved row, the school fails (`excludedOnly`) rather than publishing a fresh empty list.
  - Every other policy-rejected row still fails the school.
  - The URL policy, the stored-document validator, the default and live parsers and `createCatalog` are unchanged.
  - Callers cannot supply exclusions: `fetchArchive` honors only `strict`, `counts` and `retainedIds`. The refresh passes the retained IDs.
  - Adding or changing a digest requires a new reviewed exception.
- **Candidate validation.** The fresh list is validated again: at most 5,000 items, unique IDs, valid dates, trimmed non-empty labels of 500 characters or fewer, and the school's replay rules. Stored-document acceptance is unchanged.
- **Success.** A successful school gets `status: "ready"` and `checkedAt` set to this run's time. An empty success replaces old items.
- **Failure.** A school with successful history (`ready` or `stale`, including an empty list) becomes `stale` and keeps its items and original `checkedAt`. A school without history stays `unavailable`. A legacy `ready` record without its own time inherits the old catalog's `archive.checkedAt` only if that time is not in the future. Otherwise, and for a legacy `stale` record without a time, the time stays absent and the site shows it as unknown. A failed or retained school is never stamped.
- **Catalog time.** `archive.checkedAt` moves only when at least one school refreshed.

Limits, accepted and documented rather than solved:

- A single persistent bad eligible row keeps that school stale until the source or the private policy is corrected. Recordings stay playable.
- A provider that renames a URL tag the parser does not know makes rows read as "no recording". This is a feed-contract limitation. The parser is bounded recognition of the known contract, not a general XML parser.
- Overlapping writers are last-writer-wins on the whole document. A run that read an older document can drop another run's fresh school result or regress a school's check time. Tests characterize both. No recovery horizon is promised, and eventual consistency refers only to KV visibility; it does not heal lost updates.
- Age warnings use the viewer's clock; they are a heuristic, not an authority.

Refresh diagnostics: `refreshPrivateCatalog(env, {stats})` and `fetchArchive(..., {strict: true, counts, retainedIds})` fill caller-supplied objects with numeric per-school counts:

- `rows`, `accepted`, `unsupported`, `future`, `unrecorded`, `duplicateIdentical`, `sourceExcluded`;
- failing counts: `malformed`, `policyRejected`, `duplicateConflict`, `structural`, `excludedOnly`.

`stats` also records a fixed `outcome` (`refreshed`, `retained` or `unavailable`) and a fixed `failure` (`rows`, `candidate` or `source`). The objects never contain addresses, titles or raw errors, and the scheduled job discards raw errors. A compatibility probe may print only these counts.

### Recovering an old or stopped catalog

There is no manual "refresh now" command or endpoint. **Refresh list** in the site only reloads the published catalog. The site warns once a school's list is more than 12 hours old.

**Normal recovery (no upload):**

1. Inspect the deployed Worker version and its configuration: `ENABLE_CATALOG_REFRESH` is `"true"` and the cron trigger is `17 */6 * * *`.
2. If either is wrong, restore it from the reviewed `wrangler.jsonc` and redeploy.
3. Wait for an observed scheduled invocation result.
4. Verify per-school `status`/`checkedAt` through the public `/api/catalog/archive` projection. Never print the private document.

A school that stays stale after a successful invocation is a source or policy problem; diagnose it with the redacted counts.

**Administrative replacement** applies only when the KV document is missing or corrupt, or a reviewed policy change is needed. Before uploading:

1. Pause the schedule (`ENABLE_CATALOG_REFRESH` `"false"`) and confirm that the *deployed* version is the disabled one.
2. Obtain authoritative platform evidence that every relevant earlier scheduled invocation has completed.

These do **not** prove quiescence:

- a quiet log tail;
- an elapsed slot or arbitrary wait;
- a stable or matching digest;
- a next-slot observation;
- repeated re-uploads;
- the refresh's fail-closed handling of a missing document, because an invocation that read a valid document before the loss can still write.

If completion evidence is unavailable, **DO NOT UPLOAD.** Keep the private replacement and rollback files and use normal recovery if possible; otherwise stop and escalate.

With evidence in hand:

1. Validate the private file with `node scripts/validate-private-catalog.mjs <file>` and upload it.
2. Re-enable the schedule.
3. Verify through the public projection.

Uploaded documents keep the actual source check times, including absent (unknown) ones. Never re-stamp `checkedAt` by hand; upload time is not a source check. A digest read-back after a permitted upload is only post-hoc detection of a concurrent write, not proof that none will follow. No universal safe emergency overwrite is claimed.

## Local checks

```sh
npm ci
npm test
npm run test:worker
npm run worker:dry-run
HOMECALL_CATALOG_FILE=.private/catalog.json npm run check:private
VITE_GATEWAY_ORIGIN=http://127.0.0.1:4178 HOMECALL_CATALOG_FILE=.private/catalog.json npm run build
HOMECALL_CATALOG_FILE=.private/catalog.json npm start
```

For local HLS, also supply `MEDIA_TOKEN_KEY` privately to the Node server. `worker:dev` uses the separate local KV binding, which must be seeded locally. Synthetic tests require no actual endpoints or credentials. The optional private-inventory scan checks exact known URLs as well as structural client checks; CI alone cannot know every private value. Tests enforce catalog-only gateway routes and reject cross-origin/redirected discovery.

The relay supports GET/HEAD, single Range and If-Range, and returns 200/206/416 without caching partial bodies. It strips provider headers and errors, checks each redirect, stops upstream when the listener cancels, and does not concatenate or retry provider streams on the server. CORS permits exact configured site origins; native origin-less media requests remain supported. CORS is not authorization or quota protection. Local HTTP is restricted to loopback development. Live recovery tries the same source at most three times (1/2/4 seconds), discarding old PCM and restoring the chosen numerical delay. A pause, browser gesture requirement, or exhausted retries leaves manual recovery. No TV alignment claim is made.

## Rollout gates

The Worker forwards opaque media bodies through the runtime's native streaming path, avoiding a JavaScript callback and timer for every audio chunk throughout a listening session. On that path the frontend's existing stall watchdog owns idle recovery; the relay still bounds headers, playlists and encryption-key reads. The explicit `MEDIA_STREAM_MODE=native` setting enables this path; other values keep bounded forwarding. After headers, it removes the request-abort listener and relies on runtime body cancellation to close the upstream connection. Standalone native clients do not receive a server-side audio idle deadline. The standalone relay's default bounded wrapper remains available for callers that need a server-side idle deadline. Missing or malformed media encryption configuration returns a distinct 503 for capability and HLS operations while MP3 and catalog routes remain available.

Production has run this gateway since the September 19, 2026 cutover (site build `0.3.0+659fcd4`; [#12 cutover record](https://github.com/michaeltorbert/homecall/issues/12#issuecomment-5747055903)); the October 7, 2026 issue #4 release (PR #23) recorded Worker `a7d22be2` and Pages `0.4.0+bc6892c`, and later releases change what is served. The isolated preview Worker and private KV remain the place to test changes first. Use RELEASE-CHECKLIST.md, **Routine release and rollback**, for any redeploy or rollback; its switch-over steps are historical and are not repeated. Do not merge a frontend that points at an unprovisioned gateway. Keep a private copy of the previous catalog before any administrative catalog change and record the previous Worker version before each deployment; when a release changed both, rollback restores the Worker and frontend together.

`npm run worker:preview` builds the frontend against the isolated preview gateway and publishes its static files on the preview Worker for real-device testing. Only `/api/*` and `/media/*` invoke the Worker first; other files use static-asset routing. Production Pages hosting and gateway settings are unchanged. Preview catalog refresh remains disabled.

Production acceptance criteria (issue #12; the cutover went ahead as an owner-chosen pilot before all of them were met, and each item's met/partial/unverified/excepted status is in BACKLOG.md, **Private stream rollout**): verify all seven fixed sources (including custom ports and redirects), archive seeking/HEAD/Range, full HLS graph/timestamp/seek behavior, foreground phone audio, interruptions and a game-length session. Inspect browser requests and responses for upstream addresses. Record Free entitlement, account-wide requests/KV reads, deployed cold/warm CPU and permitted provider/platform relay use. The initial pilot proves only the observations recorded with it.

Workers Free currently allows 100,000 account-wide requests/day and 10 ms CPU/invocation; KV Free allows 100,000 reads and 1,000 writes/day. Every segment and playlist uses a Worker request and this implementation reads its catalog once per request. A separate Worker or Cache API does not expand account quota. At six-second segments plus six-second playlist reloads, four hours is about 4,800 media requests per listener before probes/discovery/other account traffic. This is a planning example, not measured demand. No paid upgrade is authorized by this implementation.

Primary references: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [KV limits](https://developers.cloudflare.com/kv/platform/limits/), [Developer Platform terms](https://www.cloudflare.com/service-specific-terms-developer-platform/), [Application Services terms](https://www.cloudflare.com/service-specific-terms-application-services/). The CDN audio restriction is not a blanket statement about all Workers usage; deployment suitability and provider permission still require case-specific confirmation.
