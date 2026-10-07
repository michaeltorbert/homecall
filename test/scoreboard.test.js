import test from 'node:test';
import assert from 'node:assert/strict';
import { createScoreboard, SCOREBOARD_POLL_MS, SCOREBOARD_WATCHDOG_MS } from '../src/scoreboard.js';
import { footballSeason } from '../src/sync-mapping.js';
// Status envelopes here are synthetic live fixtures of the supported contract, not provider samples.
const GT = '410422f0-663f-4e3d-82e2-787d954ae29d';
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const GAME = { id: 'g2', opponent: 'Duke', start: Date.parse('2026-10-10T19:30:00Z') };
const OTHER = { id: 'g1', opponent: 'Clemson', start: Date.parse('2026-09-05T19:30:00Z') };
const BOARD = { phase: 'in-progress', period: 2, clock: '7:29', scores: { 59: 17, 150: 14 } };
const providerTeams = [{ id: '150', name: 'Duke', homestreamId: '2903e5f6-960e-4954-a3ec-f7754e78660f' }, { id: '59', name: 'Georgia Tech', homestreamId: GT }];
const event = (status = 'live', { id = '401858255', board = BOARD, start = GAME.start, opponent = 'Duke' } = {}) =>
  ({ id, start, teams: ['Georgia Tech', opponent], teamIds: ['59', '150'], season: footballSeason(GAME.start), status, ...(board ? { scoreboard: board } : {}) });
const envelope = (events, { ageMs = 0 } = {}) => ({ schemaVersion: 1, teamId: '59', season: 2026, checkedAt: 1, ageMs, events });
function harness({ status = () => envelope([event()]), teams = () => providerTeams } = {}) {
  const h = { wall: 1_000_000, mono: 1_000_000, timers: [], tickers: [], timeouts: [], updates: [], calls: [], signals: [], playing: true, status, teams };
  h.doc = new EventTarget(); h.doc.visibilityState = 'visible'; h.win = new EventTarget();
  h.board = createScoreboard({
    read: async (path, options) => {
      h.calls.push(path); h.signals.push(options.signal);
      const value = path === 'sync/teams' ? h.teams(options) : h.status(path, options);
      if (value instanceof Error) throw value;
      return value instanceof Promise ? value : structuredClone(value);
    },
    clock: () => ({ wall: h.wall, mono: h.mono }), now: () => h.wall,
    timeout: () => { const controller = new AbortController(); h.timeouts.push(controller); return controller.signal; },
    setTimer: (fn, ms) => { const timer = { fn, ms, at: h.wall, cancelled: false, fired: false }; h.timers.push(timer); return timer; },
    clearTimer: timer => { if (timer) timer.cancelled = true; },
    setTicker: (fn, ms) => { const ticker = { fn, ms, cancelled: false }; h.tickers.push(ticker); return ticker; },
    clearTicker: ticker => { if (ticker) ticker.cancelled = true; },
    document: h.doc, window: h.win
  });
  h.start = (extra = {}) => h.board.start({ teamId: GT, school: 'Georgia Tech', game: GAME, games: [OTHER, GAME], eligible: () => h.playing, onUpdate: value => h.updates.push(value), ...extra });
  h.advance = ms => { h.wall += ms; h.mono += ms; };
  h.tick = () => { for (const ticker of h.tickers.filter(t => !t.cancelled)) ticker.fn(); };
  h.pending = () => h.timers.filter(t => !t.cancelled && !t.fired);
  h.fire = async (timer = h.pending()[0]) => { timer.fired = true; timer.fn(); await flush(); };
  h.last = () => h.updates.at(-1);
  h.statusCalls = () => h.calls.filter(p => p.startsWith('sync/status/'));
  return h;
}

test('a playing catalog-bound session publishes one validated snapshot with its receipt time and polls 15 s after completion', async () => {
  const h = harness();
  assert.equal(h.start(), true); await flush();
  assert.deepEqual(h.calls, ['sync/teams', 'sync/status/59/2026']);
  assert.deepEqual(h.last(), { eventId: '401858255', providerId: '59', board: BOARD, receivedAt: 1_000_000 });
  assert.deepEqual(h.pending().map(t => t.ms), [SCOREBOARD_POLL_MS]);
  assert.deepEqual(h.tickers.map(t => t.ms), [SCOREBOARD_WATCHDOG_MS]);
  h.advance(15000); await h.fire();
  assert.equal(h.last().receivedAt, 1_015_000, 'each accepted snapshot records its own receipt');
  assert.deepEqual(h.calls.filter(p => p === 'sync/teams'), ['sync/teams'], 'identity lookup is cached for the session');
  const updates = h.updates.length;
  for (let i = 0; i < 5; i++) { h.advance(1000); h.tick(); }
  assert.equal(h.updates.length, updates, 'presentation ticks never refresh the receipt time');
});
test('live to non-live, unknown, malformed board and missing board remove volatile data immediately', async () => {
  for (const next of [envelope([event('completed', { board: null })]), envelope([event('unknown')]), envelope([event('live', { board: { ...BOARD, clock: '99:99' } })]), envelope([event('live', { board: null })]), envelope([])]) {
    let value = envelope([event()]);
    const h = harness({ status: () => value });
    h.start(); await flush();
    assert.equal(h.last().board.phase, 'in-progress');
    value = next; h.advance(15000); await h.fire();
    assert.equal(h.last(), null, JSON.stringify(next.events[0]?.status));
    assert.deepEqual(h.pending().map(t => t.ms), [15000], 'a valid response is still a successful poll');
  }
});
test('failures clear immediately and back off 30/60/120 s; success resets to 15 s; status failure never touches the session', async () => {
  let fail = false;
  const h = harness({ status: () => fail ? Error('502') : envelope([event()]) });
  h.start(); await flush();
  fail = true;
  for (let i = 0; i < 4; i++) { await h.fire(); assert.equal(h.last(), null); }
  fail = false; await h.fire();
  assert.equal(h.last().board.period, 2);
  assert.deepEqual(h.timers.map(t => t.ms), [15000, 30000, 60000, 120000, 120000, 15000]);
  assert.equal(h.board.active, true);
});
test('freshness: server age plus request duration is bounded at 45 s by the independent watchdog; unknown age or a clock step never shows data', async () => {
  const h = harness({ status: () => envelope([event()], { ageMs: 40000 }) });
  h.start(); await flush();
  assert.equal(h.last().board.clock, '7:29');
  for (let i = 0; i < 4; i++) { h.advance(1000); h.tick(); }
  assert.notEqual(h.last(), null, '44 s old');
  h.advance(1000); h.tick();
  assert.equal(h.last(), null, 'expires at 45 s without any network completion');
  const slow = harness({ status: () => { slow.advance(6000); return envelope([event()], { ageMs: 39000 }); } });
  slow.start(); await flush();
  assert.equal(slow.updates.length, 0, 'request duration counts toward the budget');
  const unknown = harness({ status: () => envelope([event()], { ageMs: null }) });
  unknown.start(); await flush();
  assert.equal(unknown.updates.length, 0);
  const step = harness();
  step.start(); await flush();
  step.wall -= 5000; step.mono += 1000; step.tick();
  assert.equal(step.last(), null, 'wall clock stepped backward');
});
test('a hanging status read is expired by the watchdog, never overlapped, and its deadline schedules a retry', async () => {
  let hang = false;
  const h = harness({ status: () => hang ? new Promise(() => {}) : envelope([event()]) });
  h.start(); await flush();
  hang = true; h.advance(15000); await h.fire();
  const reads = h.calls.length;
  for (let i = 0; i < 30; i++) { h.advance(1000); h.tick(); }
  assert.equal(h.last(), null); assert.equal(h.calls.length, reads); assert.equal(h.pending().length, 0);
  h.timeouts.at(-1).abort(new DOMException('deadline', 'TimeoutError')); await flush();
  assert.deepEqual(h.pending().map(t => t.ms), [30000]);
});
test('the first matched event is frozen for the audio session; a different event for the same game is denied', async () => {
  let value = envelope([event()]);
  const h = harness({ status: () => value });
  h.start(); await flush();
  assert.equal(h.last().eventId, '401858255');
  value = envelope([event('live', { id: '999' })]); await h.fire();
  assert.equal(h.last(), null);
  value = envelope([event()]); await h.fire();
  assert.equal(h.last().eventId, '401858255');
  // A non-live first match also freezes identity.
  let early = envelope([event('upcoming', { board: null })]);
  const f = harness({ status: () => early });
  f.start(); await flush();
  assert.equal(f.updates.length, 0);
  early = envelope([event('live', { id: '777' })]); await f.fire();
  assert.equal(f.updates.length, 0, 'a replacement event never inherits the session');
});
test('catalog-wide one-to-one matching: ambiguous provider events and duplicate catalog claims yield no scoreboard', async () => {
  const twin = { ...GAME, id: 'g2-replay', start: GAME.start + 3600 * 1000 };
  const h = harness();
  h.start({ games: [GAME, twin] }); await flush();
  assert.equal(h.updates.length, 0); assert.deepEqual(h.statusCalls(), ['sync/status/59/2026']);
  const a = harness({ status: () => envelope([event(), event('live', { id: '888', start: GAME.start + 3600 * 1000 })]) });
  a.start(); await flush();
  assert.equal(a.updates.length, 0);
  const wrongOpponent = harness({ status: () => envelope([event('live', { opponent: 'Virginia' })]) });
  wrongOpponent.start(); await flush();
  assert.equal(wrongOpponent.updates.length, 0, 'no fuzzy school matching');
});
test('identity requires the exact catalog UUID and school; invalid sessions never start', async () => {
  for (const [teamId, school] of [[GT, 'Virginia Tech'], ['b3c33c46-a9e4-4e3b-9d5a-4fefb625f14c', 'Georgia Tech'], [GT, 'Georgia']]) {
    const h = harness();
    h.start({ teamId, school }); await flush();
    assert.deepEqual(h.calls, ['sync/teams'], school); assert.equal(h.updates.length, 0);
    assert.deepEqual(h.pending().map(t => t.ms), [30000]);
  }
  const d = harness({ teams: () => [...providerTeams, providerTeams[1]] });
  d.start(); await flush();
  assert.deepEqual(d.calls, ['sync/teams'], 'duplicate identity rows are ambiguous');
  for (const extra of [{ game: { ...GAME, start: null } }, { games: [OTHER] }, { games: [GAME, GAME] }, { games: null }, { teamId: '' }, { school: ' ' }]) {
    const h = harness();
    assert.equal(h.start(extra), false, JSON.stringify(extra)); await flush();
    assert.equal(h.calls.length, 0); assert.equal(h.tickers.length, 0); assert.equal(h.board.active, false);
  }
});
test('a timed-out identity lookup retries with a new request and the late result cannot populate the cache', async () => {
  const lookups = [];
  const h = harness({ teams: () => { const gate = deferred(); lookups.push(gate); return gate.promise; } });
  h.start(); await flush();
  h.timeouts.at(-1).abort(new DOMException('deadline', 'TimeoutError')); await flush();
  assert.deepEqual(h.pending().map(t => t.ms), [30000]);
  await h.fire();
  assert.equal(lookups.length, 2);
  lookups[1].resolve(structuredClone(providerTeams)); await flush();
  assert.equal(h.last().providerId, '59');
  lookups[0].resolve([{ id: '150', name: 'Georgia Tech', homestreamId: GT }]); await flush();
  await h.fire();
  assert.equal(lookups.length, 2); assert.deepEqual([...new Set(h.statusCalls())], ['sync/status/59/2026'], 'the late lookup never redirected identity');
});
test('only actual playback is eligible: pause aborts and clears at once; returning to playback polls immediately', async () => {
  const gates = [];
  const h = harness({ status: () => { const gate = deferred(); gates.push(gate); return gate.promise; } });
  h.start(); await flush();
  gates[0].resolve(envelope([event()])); await flush();
  assert.equal(h.last().board.period, 2);
  await h.fire();
  const inFlight = h.signals.at(-1);
  h.playing = false; h.board.check();
  assert.equal(inFlight.aborted, true); assert.equal(h.last(), null); assert.equal(h.pending().length, 0);
  gates[1].resolve(envelope([event()])); await flush();
  assert.equal(h.last(), null, 'a result arriving after pause cannot republish');
  for (let i = 0; i < 60; i++) { h.advance(1000); h.tick(); }
  assert.equal(h.statusCalls().length, 2, 'no polling while not playing');
  h.playing = true; h.tick(); await flush();
  assert.equal(h.statusCalls().length, 3, 'eligibility return triggers an immediate fresh poll');
  gates[2].resolve(envelope([event()])); await flush();
  assert.equal(h.last().board.period, 2);
});
test('a result accepted while ineligible is discarded even before the watchdog notices', async () => {
  const gate = deferred();
  const h = harness({ status: () => gate.promise });
  h.start(); await flush();
  h.playing = false; gate.resolve(envelope([event()])); await flush();
  assert.equal(h.updates.length, 0); assert.equal(h.pending().length, 0);
});
test('stop and replacement sessions retire late results even for the same game ID', async () => {
  const gates = [];
  const h = harness({ status: () => { const gate = deferred(); gates.push(gate); return gate.promise; } });
  h.start(); await flush();
  const firstUpdates = [];
  h.board.stop();
  h.start({ onUpdate: value => firstUpdates.push(value) }); await flush();
  gates[0].resolve(envelope([event()])); await flush();
  assert.equal(h.updates.length, 0); assert.equal(firstUpdates.length, 0);
  assert.equal(h.tickers.filter(t => !t.cancelled).length, 1, 'one watchdog per session');
  h.board.stop();
  gates[1].resolve(envelope([event()])); await flush();
  assert.equal(firstUpdates.length, 0); assert.equal(h.pending().length, 0);
});
test('stop clears published data; invalidate keeps the session and requires a fresh response', async () => {
  const h = harness();
  h.start(); await flush();
  h.board.invalidate();
  assert.equal(h.last(), null); assert.equal(h.board.active, true);
  await flush();
  assert.equal(h.statusCalls().length, 2); assert.equal(h.last().board.period, 2);
  h.board.stop();
  assert.equal(h.last(), null); assert.equal(h.board.active, false);
  assert.ok(h.tickers.every(t => t.cancelled)); assert.equal(h.pending().length, 0);
});
test('hidden documents keep polling while audio plays; visible return checks expiry first, then polls immediately', async () => {
  const h = harness({ status: () => envelope([event()], { ageMs: 30000 }) });
  h.start(); await flush();
  h.doc.visibilityState = 'hidden'; h.doc.dispatchEvent(new Event('visibilitychange'));
  h.advance(15000); await h.fire();
  assert.equal(h.statusCalls().length, 2, 'not paused merely because the tab is hidden');
  // Timers may be throttled in the background; simulate a missed watchdog and timer.
  h.advance(20000);
  h.doc.visibilityState = 'visible';
  const before = h.updates.length;
  h.doc.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(h.updates.slice(before), [null], 'expired data is removed before any refresh is published');
  await flush();
  assert.equal(h.statusCalls().length, 3, 'the scheduled timer is replaced by an immediate poll');
  assert.equal(h.last().board.period, 2);
  assert.equal(h.pending().length, 1);
});
test('pagehide and freeze abort and clear; while parked nothing polls; pageshow and resume revalidate from neutral', async () => {
  for (const [park, target, resume, back] of [['pagehide', 'win', 'pageshow', 'win'], ['freeze', 'doc', 'resume', 'doc']]) {
    const h = harness();
    h.start(); await flush();
    await h.fire();
    h[target].dispatchEvent(new Event(park));
    assert.equal(h.last(), null, park); assert.equal(h.pending().length, 0);
    for (let i = 0; i < 30; i++) { h.advance(1000); h.tick(); }
    assert.equal(h.statusCalls().length, 2, `${park}: parked sessions do not poll`);
    h[back].dispatchEvent(new Event(resume)); await flush();
    assert.equal(h.statusCalls().length, 3, resume); assert.equal(h.last().board.period, 2);
  }
});
test('a throwing metadata consumer cannot stop polling', async () => {
  const h = harness();
  h.start({ onUpdate: () => { throw Error('render'); } }); await flush();
  assert.deepEqual(h.pending().map(t => t.ms), [15000]);
});
