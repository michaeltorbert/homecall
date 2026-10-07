import { createTimingFreshness, nextPollDelay } from './timing-freshness.js';
import { schoolKey, footballSeason, matchEvent, clockSeconds } from './sync-mapping.js';
// Source-reported game status for option labels only. No audio, player, timing-source,
// calibration or selection dependency: a status update can only change label text.
export const STATUS_LABELS = Object.freeze({ live: 'LIVE', upcoming: 'Upcoming', completed: 'Completed', unavailable: 'Status unavailable' });
export const STATUS_TIMEOUT_MS = 10000;
export const MAX_STATUS_SEASONS = 2;
const STATES = new Set(['live', 'upcoming', 'completed', 'unknown']);
const validId = value => typeof value === 'string' && /^\d{1,12}$/.test(value);
const validSeason = value => Number.isInteger(value) && value >= 2000 && value < 2100;
const counts = values => { const map = new Map(); for (const value of values) map.set(value, (map.get(value) || 0) + 1); return map; };
const PHASES = new Set(['in-progress', 'halftime']), BOARD_KEYS = new Set(['phase', 'period', 'clock', 'scores']);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
// Optional live scoreboard. A malformed board is dropped; its event and status stay valid.
export function validateScoreboard(board, teamIds) {
  if (!plain(board) || !PHASES.has(board.phase) || Object.keys(board).some(key => !BOARD_KEYS.has(key))) return null;
  const result = { phase: board.phase };
  if ('period' in board) {
    if (!Number.isInteger(board.period) || board.period < 1 || board.period > 99) return null;
    result.period = board.period;
  }
  if ('clock' in board) {
    if (board.phase !== 'in-progress' || !(result.period <= 4) || typeof board.clock !== 'string' || !/^\d{1,2}:[0-5]\d$/.test(board.clock) || !(clockSeconds(board.clock) <= 900)) return null;
    result.clock = board.clock;
  }
  if ('scores' in board) {
    const scores = board.scores;
    if (!plain(scores) || Object.keys(scores).length !== 2 || !teamIds.every(id => Object.hasOwn(scores, id) && Number.isInteger(scores[id]) && scores[id] >= 0 && scores[id] <= 999)) return null;
    result.scores = Object.fromEntries(teamIds.map(id => [id, scores[id]]));
  }
  return result;
}

export function validateStatusSnapshot(data, { teamId, season }) {
  if (data?.schemaVersion !== 1 || data.teamId !== teamId || data.season !== season || !Array.isArray(data.events)) throw Error('status-invalid');
  const events = data.events.filter(e => e && validId(e.id) && Number.isFinite(e.start) && e.season === season && STATES.has(e.status) &&
    Array.isArray(e.teams) && e.teams.length === 2 && e.teams.every(t => typeof t === 'string' && t.trim()) &&
    Array.isArray(e.teamIds) && e.teamIds.length === 2 && e.teamIds.every(validId) && new Set(e.teamIds).size === 2 && e.teamIds.includes(teamId));
  const ids = counts(events.map(e => e.id));
  return events.filter(e => ids.get(e.id) === 1).map(e => {
    const event = { id: e.id, start: e.start, teams: [...e.teams], teamIds: [...e.teamIds], season: e.season, status: e.status };
    const scoreboard = e.status === 'live' && e.scoreboard !== undefined ? validateScoreboard(e.scoreboard, event.teamIds) : null;
    return scoreboard ? { ...event, scoreboard } : event;
  });
}
// Only the two most recent catalog seasons are polled; older games stay unavailable.
export function statusSeasons(games) {
  return [...new Set(games.filter(g => Number.isFinite(g?.start)).map(g => footballSeason(g.start)).filter(validSeason))].sort((a, b) => b - a).slice(0, MAX_STATUS_SEASONS);
}
// One-to-one: an event claimed by several catalog games matches none of them.
export function gameMatches(games, school, snapshots) {
  const gameIds = counts(games.map(g => g.id));
  const matched = games.map(game => {
    const snapshot = Number.isFinite(game.start) ? snapshots.get(footballSeason(game.start)) : null;
    return [game, snapshot ? matchEvent(snapshot.events, school, game, snapshot.providerId) : null];
  });
  const claims = counts(matched.filter(([, event]) => event).map(([, event]) => event.id));
  return new Map(matched.map(([game, event]) => [game.id, event && gameIds.get(game.id) === 1 && claims.get(event.id) === 1 ? event : null]));
}
export function gameStatuses(games, school, snapshots) {
  return new Map([...gameMatches(games, school, snapshots)].map(([id, event]) => [id, event && event.status !== 'unknown' ? event.status : 'unavailable']));
}
export function createGameStatus({ read, onUpdate, enabled = () => true, clock, timeout = ms => AbortSignal.timeout(ms), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = timer => clearTimeout(timer) }) {
  let generation = 0, catalog = null, seasons = new Map(), run = null, teams = null, teamsRequest = null, lifecycle = 0, published = '';
  function publish(force = false) {
    if (!catalog) return;
    const fresh = new Map();
    for (const entry of seasons.values()) if (entry.events && entry.freshness.fresh()) fresh.set(entry.season, entry);
    const labels = new Map([...gameStatuses(catalog.games, catalog.school, fresh)].map(([id, state]) => [id, STATUS_LABELS[state]]));
    const key = JSON.stringify([...labels]);
    if (!force && key === published) return;
    published = key;
    try { onUpdate(labels); } catch { /* Labels cannot affect playback or the catalog. */ }
  }
  function halt() {
    generation++; run?.abort(); run = null; teamsRequest = null;
    for (const entry of seasons.values()) { clearTimer(entry.timer); entry.timer = null; entry.events = null; entry.freshness.invalidate(); }
  }
  // Abort-insensitive reads still end the poll when its signal does.
  const bounded = (promise, signal) => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
  function supportedTeams(signal) {
    if (teams) return Promise.resolve(teams);
    if (!teamsRequest) {
      const life = lifecycle, request = teamsRequest = Promise.resolve().then(() => read('sync/teams', { signal })).then(list => {
        if (!Array.isArray(list)) throw Error('status-teams-invalid');
        const valid = list.filter(t => t && validId(t.id) && typeof t.name === 'string' && typeof t.homestreamId === 'string').map(t => ({ id: t.id, name: t.name, homestreamId: t.homestreamId }));
        // A retired (timed-out, halted or superseded) lookup can never populate the cache.
        if (life === lifecycle && teamsRequest === request) teams = valid;
        return valid;
      }).finally(() => { if (teamsRequest === request) teamsRequest = null; });
    }
    // Any sharing caller's deadline retires the lookup, so a retry issues a new one
    // even when the abandoned read never settles.
    const request = teamsRequest, retire = () => { if (teamsRequest === request) teamsRequest = null; };
    if (signal.aborted) retire(); else signal.addEventListener('abort', retire, { once: true });
    return request;
  }
  async function poll(entry, gen, runSignal) {
    entry.timer = null;
    if (gen !== generation) return;
    const signal = AbortSignal.any([runSignal, timeout(STATUS_TIMEOUT_MS)]);
    let success = false;
    try {
      const list = await bounded(supportedTeams(signal), signal);
      if (gen !== generation) return;
      const matches = list.filter(t => t.homestreamId === catalog.teamId && schoolKey(t.name) === schoolKey(catalog.school));
      if (matches.length !== 1) throw Error('status-identity-unavailable');
      const started = entry.freshness.start();
      const data = await bounded(read(`sync/status/${matches[0].id}/${entry.season}`, { signal }), signal);
      if (gen !== generation) return;
      entry.events = validateStatusSnapshot(data, { teamId: matches[0].id, season: entry.season });
      entry.providerId = matches[0].id;
      entry.freshness.receive(data, started);
      success = true;
    } catch {
      if (gen !== generation) return;
      entry.events = null; entry.freshness.invalidate();
    }
    publish();
    // The next poll is scheduled from completion; requests never overlap per season.
    entry.delay = success ? 15000 : nextPollDelay(entry.delay, false);
    entry.timer = setTimer(() => void poll(entry, gen, runSignal), entry.delay);
  }
  function start() {
    if (!catalog || run || !enabled()) return;
    const gen = generation, controller = run = new AbortController();
    for (const entry of seasons.values()) { entry.delay = 15000; void poll(entry, gen, controller.signal); }
  }
  return {
    setGames({ games, teamId, school }) {
      halt();
      catalog = { games: games.map(({ id, start, opponent }) => ({ id, start, opponent })), teamId, school };
      seasons = new Map(statusSeasons(catalog.games).map(season => [season, { season, freshness: createTimingFreshness({ clock }), events: null, providerId: null, timer: null, delay: 15000 }]));
      publish(true); start();
    },
    clear() { halt(); publish(); catalog = null; seasons = new Map(); published = ''; },
    suspend() { halt(); publish(); },
    resume() { start(); },
    stop() { this.clear(); lifecycle++; teams = null; },
    // Labels expire on the visible/active tick, independent of network completion.
    tick() { publish(); }
  };
}
