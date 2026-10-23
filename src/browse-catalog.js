// Read-only browsing of published catalog games for Team pages and the weekly Schedule (issue #68).
// It reads the existing homestream/games/<id> endpoint only when a page asks, caches each school's
// validated list for a bounded time, runs a bounded number of reads at once and honors cancellation.
// It never probes playlists, polls, plays audio, or touches the Player's catalog, game or source;
// a playlist check happens only after the listener chooses to listen, through the Player.
import { validateGames } from './homestream.js';

export const MAX_AGE_MS = 5 * 60_000;
export const CONCURRENCY = 3;
const pad = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// A real calendar date in YYYY-MM-DD form, or false.
export function calendarDay(value) {
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m) return false;
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return day.toISOString().slice(0, 10) === value;
}
// The current local calendar week, Monday through Sunday. Date arithmetic, not 7 × 24 h, so a
// daylight-saving change cannot move the boundary.
export function currentWeek(now = Date.now()) {
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  const sunday = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { start: start.getTime(), end: end.getTime(), first: dateKey(start), last: dateKey(sunday) };
}
// Where a catalog game falls for this week: 'timed' (a finite start in the week), 'tbd' (no start
// but a catalog calendar date in the week), 'outside', or 'undated' (neither, so it is never claimed).
export function weekPlacement(game, week) {
  if (Number.isFinite(game?.start)) return game.start >= week.start && game.start < week.end ? 'timed' : 'outside';
  if (calendarDay(game?.date)) return game.date >= week.first && game.date <= week.last ? 'tbd' : 'outside';
  return 'undated';
}
// read(path, { signal }) resolves parsed JSON for a metadata path.
export function createBrowseCatalog({ read, validate = validateGames, now = () => Date.now(), maxAge = MAX_AGE_MS, concurrency = CONCURRENCY } = {}) {
  const cache = new Map();
  // fresh: an explicit Refresh skips the cached list.
  async function games(teamId, { signal, fresh = false } = {}) {
    if (typeof teamId !== 'string' || !teamId) throw Error('catalog-invalid');
    const hit = cache.get(teamId);
    if (!fresh && hit && now() - hit.at >= 0 && now() - hit.at < maxAge) return hit.games;
    const loaded = await read(`homestream/games/${encodeURIComponent(teamId)}`, { signal });
    if (signal?.aborted) throw signal.reason ?? Error('aborted');
    const list = validate(loaded, teamId);
    // Bounded: one entry per school, replaced on each successful read.
    cache.set(teamId, { at: now(), games: list });
    return list;
  }
  // schools: [{ key, name, catalogId }]. Partial failure is reported per school; a canceled load rejects.
  async function week(schools, { signal, fresh = false } = {}) {
    const range = currentWeek(now());
    const entries = [], undated = [], failed = [];
    const queue = schools.filter(school => school?.catalogId);
    async function worker() {
      while (queue.length) {
        const school = queue.shift();
        try {
          const list = await games(school.catalogId, { signal, fresh });
          for (const game of list) {
            const placement = weekPlacement(game, range);
            if (placement === 'timed' || placement === 'tbd') entries.push({ key: school.key, school: school.name, game, placement });
            else if (placement === 'undated') undated.push({ key: school.key, school: school.name, game });
          }
        } catch (error) {
          if (signal?.aborted) throw error;
          failed.push(school.name);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    if (signal?.aborted) throw signal.reason ?? Error('aborted');
    // Timed games in order; a date-only game sorts at the start of its day and says Time TBD.
    const sortKey = entry => entry.placement === 'timed' ? entry.game.start : new Date(`${entry.game.date}T00:00:00`).getTime();
    entries.sort((a, b) => sortKey(a) - sortKey(b) || a.school.localeCompare(b.school));
    return { week: range, entries, undated, failed, schools: schools.filter(school => school?.catalogId).length };
  }
  return { games, week, invalidate() { cache.clear(); } };
}
