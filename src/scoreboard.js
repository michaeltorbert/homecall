import { createTimingFreshness, nextPollDelay } from './timing-freshness.js';
import { validateStatusSnapshot, gameMatches, STATUS_TIMEOUT_MS } from './game-status.js';
import { schoolKey, footballSeason } from './sync-mapping.js';
// Volatile score/period/clock for the one catalog game a playing audio session is bound to.
// It reads the existing status envelope only. It never touches audio, timing seeks, labels or
// the session identity: any doubt removes the volatile snapshot and nothing else.
export const SCOREBOARD_POLL_MS = 15000, SCOREBOARD_WATCHDOG_MS = 1000;
export function createScoreboard({ read, clock, now = () => Date.now(), timeout = ms => AbortSignal.timeout(ms),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = timer => clearTimeout(timer),
  setTicker = (fn, ms) => setInterval(fn, ms), clearTicker = timer => clearInterval(timer), window: win = null, document: doc = null } = {}) {
  let session = null, generation = 0, lifecycle = 0, teams = null, teamsRequest = null;
  const playing = s => { try { return !!s.eligible(); } catch { return false; } };
  const emit = (s, value) => { try { s.onUpdate(value); } catch { /* Metadata cannot affect polling or audio. */ } };
  function clearVolatile(s) { if (s.shown) { s.shown = false; emit(s, null); } }
  function halt(s) {
    generation++; s.run?.abort(); s.run = null; s.inFlight = false; teamsRequest = null;
    clearTimer(s.timer); s.timer = null; s.freshness.invalidate();
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
        if (!Array.isArray(list)) throw Error('scoreboard-teams-invalid');
        const valid = list.filter(t => t && typeof t.id === 'string' && /^\d{1,12}$/.test(t.id) && typeof t.name === 'string' && typeof t.homestreamId === 'string');
        // A retired (timed-out, halted or superseded) lookup can never populate the cache.
        if (life === lifecycle && teamsRequest === request) teams = valid;
        return valid;
      }).finally(() => { if (teamsRequest === request) teamsRequest = null; });
    }
    const request = teamsRequest, retire = () => { if (teamsRequest === request) teamsRequest = null; };
    if (signal.aborted) retire(); else signal.addEventListener('abort', retire, { once: true });
    return request;
  }
  async function poll(s, gen, runSignal) {
    s.timer = null;
    if (gen !== generation || session !== s) return;
    s.inFlight = true;
    // One deadline covers the identity lookup and the status read.
    const signal = AbortSignal.any([runSignal, timeout(STATUS_TIMEOUT_MS)]);
    let success = false, value = null;
    try {
      const list = await bounded(supportedTeams(signal), signal);
      if (gen !== generation) return;
      const matches = list.filter(t => t.homestreamId === s.teamId && schoolKey(t.name) === schoolKey(s.school));
      if (matches.length !== 1) throw Error('scoreboard-identity-unavailable');
      const providerId = matches[0].id, started = s.freshness.start();
      const data = await bounded(read(`sync/status/${providerId}/${s.season}`, { signal }), signal);
      if (gen !== generation) return;
      const events = validateStatusSnapshot(data, { teamId: providerId, season: s.season });
      s.freshness.receive(data, started); success = true;
      // Full-catalog one-to-one matching; the first matched event is frozen for this audio session.
      const event = gameMatches(s.games, s.school, new Map([[s.season, { events, providerId }]])).get(s.game.id);
      if (event && s.eventId === null) s.eventId = event.id;
      if (event && event.id === s.eventId && event.status === 'live' && event.scoreboard && s.freshness.fresh() && playing(s))
        value = { eventId: event.id, providerId, board: event.scoreboard, receivedAt: now() };
    } catch {
      if (gen !== generation) return;
      s.freshness.invalidate();
    }
    s.inFlight = false;
    if (value) { s.shown = true; emit(s, value); } else clearVolatile(s);
    if (!playing(s)) { halt(s); clearVolatile(s); return; }
    // The next poll is scheduled from completion; requests never overlap.
    s.delay = success ? SCOREBOARD_POLL_MS : nextPollDelay(s.delay, false);
    s.timer = setTimer(() => void poll(s, gen, runSignal), s.delay);
  }
  function begin(s) {
    if (s.run || s.parked || !playing(s)) return;
    const gen = generation, controller = s.run = new AbortController();
    s.delay = SCOREBOARD_POLL_MS; void poll(s, gen, controller.signal);
  }
  // Independent of network completion: eligibility and freshness are rechecked every second.
  function check() {
    const s = session;
    if (!s || s.parked) return;
    if (!playing(s)) { if (s.run) halt(s); clearVolatile(s); return; }
    if (s.shown && !s.freshness.fresh()) clearVolatile(s);
    begin(s);
  }
  // Expiry is checked before any refresh; an idle poller asks again immediately.
  function revalidate() {
    const s = session;
    if (!s || s.parked) return;
    if (s.shown && !s.freshness.fresh()) clearVolatile(s);
    if (s.run && !s.inFlight && playing(s)) {
      clearTimer(s.timer); s.timer = null; void poll(s, generation, s.run.signal);
    } else check();
  }
  function park() { const s = session; if (!s) return; s.parked = true; halt(s); clearVolatile(s); }
  function unpark() { const s = session; if (!s || !s.parked) return; s.parked = false; revalidate(); }
  doc?.addEventListener('visibilitychange', () => { if (doc.visibilityState !== 'hidden') revalidate(); });
  doc?.addEventListener('freeze', park); doc?.addEventListener('resume', unpark);
  win?.addEventListener('pagehide', park); win?.addEventListener('pageshow', unpark);
  return {
    // teamId is the Homestream catalog UUID; games is the full catalog the game came from.
    start({ teamId, school, game, games, eligible, onUpdate }) {
      this.stop();
      if (typeof teamId !== 'string' || !teamId || typeof school !== 'string' || !school.trim() || !game || !Number.isFinite(game.start) ||
          !Array.isArray(games) || games.filter(g => g?.id === game.id).length !== 1 || typeof eligible !== 'function' || typeof onUpdate !== 'function') return false;
      const s = session = { teamId, school, game: { id: game.id, start: game.start, opponent: game.opponent }, games: games.map(({ id, start, opponent }) => ({ id, start, opponent })),
        season: footballSeason(game.start), eligible, onUpdate, freshness: createTimingFreshness({ clock }), eventId: null, run: null, timer: null, delay: SCOREBOARD_POLL_MS, shown: false, parked: false, inFlight: false };
      s.ticker = setTicker(check, SCOREBOARD_WATCHDOG_MS);
      check();
      return true;
    },
    stop() {
      const s = session;
      if (!s) return;
      session = null; halt(s); clearTicker(s.ticker); clearVolatile(s);
      lifecycle++; teams = null;
    },
    // An internal reconnect keeps the session and its frozen event but needs a fresh response.
    invalidate() { const s = session; if (!s) return; halt(s); clearVolatile(s); check(); },
    check,
    get active() { return !!session; }
  };
}
