# Kickoff times and confidence (issue #44)

The Game picker shows a kickoff time as confirmed only when the sports-data source says the time is
set. This note records the source evidence and the rule. Public data only: provider event IDs, public
DTO fields and public school pages. No private catalog or upstream URL is quoted.

## Sources

| Source | Field | What it says |
|---|---|---|
| Homestream catalog (public DTO `/api/homestream/games/<team>`) | `start` (epoch ms), `date` (`YYYY-MM-DD`) | A timestamp for every game. It carries no time-confidence field. |
| ESPN public team schedule (via `/api/sync/status/<team>/<season>`) | `events[].timeValid` and `events[].competitions[0].timeValid` | `true` when the provider has a kickoff time, `false` when the time is TBD. |
| goduke.com football schedule and ticket pages | Text | Corroboration only, from an extract: Oct. 31 vs Boston College listed with time TBA. |

## Evidence (Duke 2026, raw provider schedule observed 2026-10-14 and 2026-10-15)

- **TBD.** Both flags are `false` on four events, whose status `detail` is TBD:
  - `401858279` Boston College, Oct. 31
  - `401858286` NC State, Nov. 7
  - `401858296` Miami, Nov. 14
  - `401858312` Wake Forest, Nov. 28

  Their provider `date` is local midnight Eastern, for example `2026-10-31T04:00Z`. The catalog lists the same games at 12:34 PM Eastern, for example `start` `1793464440000`.
- **Confirmed.** Every other 2026 event has both flags `true`, for example `401858266` North Carolina, `401858271` Virginia and `401858303` Clemson. Each catalog `start` equals the provider start exactly.
- **Unmatched.** Syracuse (Sept. 9) is in the catalog but has no provider event, so it can never be confirmed or TBD.
- The live Worker status route was checked after the stage A deploy (2026-10-15). It returned `kickoff: "tbd"` for the four IDs above and `"confirmed"` for 266, 271 and 303.

**Not established:** whether 12:34 PM is a deliberate placeholder in the catalog. No source field says so. Homecall therefore never treats 12:34, midnight or any other clock value as a signal. A real game scheduled at 12:34 PM is shown as an ordinary confirmed time. No "provisional" state exists, because no source field supports one.

## Rule

1. **Worker** (`lib/timing-normalize.mjs` `normalizeKickoff`): `kickoff` is `"confirmed"` when the event and its sole competition both have `timeValid === true`, and `"tbd"` when both are `false`.
   - Any other combination (a flag missing on either, disagreeing flags, a non-boolean) omits `kickoff`.
   - The status enum, scoreboard, freshness and `/api/sync/schedule` are unchanged.
2. **Frontend** (`src/game-status.js` `gameKickoffs`): only fresh status data with a one-to-one catalog match counts.
   - **TBD:** `kickoff` is `"tbd"`. The start times do not need to agree; the provider date is a placeholder.
   - **Confirmed:** `kickoff` is `"confirmed"` *and* the provider start equals the catalog `start` exactly.
   - **Unconfirmed:** everything else. That covers missing, stale, malformed, unmatched or ambiguous data, legacy data with no `kickoff`, the time before the first status arrives, and a confirmed provider time that differs from the catalog.
3. **Labels** (`src/homestream-ui.js`):
   - Confirmed: `Oct 17, 3:30 PM · vs North Carolina`, the catalog time exactly as before #44.
   - TBD: `Oct 31, Time TBD · vs Boston`. The date is the catalog `date`, formatted in UTC so it never shifts a day. An invalid `date` shows `Date pending`; the label never falls back to `start`.
   - Unconfirmed: `Oct 31, 12:34 PM (time unconfirmed) · vs Boston`.

   Status prefixes (`Upcoming ·`, `Status unavailable ·`) and the `· feed not published` suffix are unchanged. A relabel changes text only. Option values, order, selection, focus, disabled state, feed probes and readiness are untouched.

The catalog lists the game as "Boston" and the provider as "Boston College". This is matched by one exact alias in `schoolKey` (`boston` → `bostoncollege`), never fuzzy matching.

## Unchanged, and known limits

- **Default game choice** (`defaultGame`, `initial()`) still orders games by the catalog `start`.
  - A TBD game whose catalog time is 12:34 PM counts as started after 12:34 PM local on that date, exactly as before.
  - The alias lets the Boston College game carry real provider status (live, upcoming or completed) for default choice, scoreboard and clock matching. Before, it read as unavailable.
- **Kickoff is not the broadcast start.** The Duke network countdown (`/api/broadcast/schedule/duke`, `BROADCAST-SCHEDULE.md`) uses its own broadcaster schedule and is not affected.
- **Confidence covers the latest fresh snapshot only.** The provider may reschedule a game. When data goes stale, every time reverts to unconfirmed.
- Only the two most recent catalog seasons are polled, so older games always read as unconfirmed.
