import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameStatus, validateStatusSnapshot, validateScoreboard, statusSeasons, gameStatuses, gameMatches, gameKickoffs, STATUS_LABELS } from '../src/game-status.js';
import { metadataGateway } from '../lib/metadata-gateway.mjs';
import { footballSeason } from '../src/sync-mapping.js';
const DUKE = '2903e5f6-960e-4954-a3ec-f7754e78660f', GT = '410422f0-663f-4e3d-82e2-787d954ae29d';
const UNAVAILABLE = STATUS_LABELS.unavailable;
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const G1 = { id: 'g1', opponent: 'Illinois', start: Date.parse('2026-09-05T19:30:00Z') };
const G2 = { id: 'g2', opponent: 'Tulane', start: Date.parse('2026-10-10T19:30:00Z') };
const G3 = { id: 'g3', opponent: 'Clemson', start: null };
const G4 = { id: 'g4', opponent: 'Old Opponent', start: Date.parse('2024-09-07T19:30:00Z') };
const G5 = { id: 'g5', opponent: 'Mid Opponent', start: Date.parse('2025-09-06T19:30:00Z') };
const ev = (id, game, status, { school = 'Duke', teamId = '150', start = game.start } = {}) => ({ id, start, teams: [school, game.opponent], teamIds: [teamId, '2390'], season: footballSeason(game.start), status });
const envelope = (season, events, { ageMs = 0, teamId = '150' } = {}) => ({ schemaVersion: 1, teamId, season, checkedAt: 1, ageMs, events });
const providerTeams = [{ id: '150', name: 'Duke', homestreamId: DUKE }, { id: '59', name: 'Georgia Tech', homestreamId: GT }];
const standard = { 'sync/teams': providerTeams, 'sync/status/150/2026': envelope(2026, [ev('101', G1, 'completed'), ev('102', G2, 'upcoming')]), 'sync/status/150/2025': envelope(2025, [ev('201', G5, 'live')]) };
function harness({ read, enabled = () => true, onUpdate } = {}) {
  const h = { wall: 1_000_000, mono: 1_000_000, timers: [], timeouts: [], updates: [], kickoffs: [], calls: [], signals: [] };
  h.status = createGameStatus({
    read: (path, options) => { h.calls.push(path); h.signals.push(options.signal); return read(path, options); },
    enabled: () => enabled(), clock: () => ({ wall: h.wall, mono: h.mono }),
    onUpdate: (labels, kickoffs) => { h.updates.push(Object.fromEntries(labels)); h.kickoffs.push(Object.fromEntries(kickoffs)); onUpdate?.(labels, kickoffs); },
    setTimer: (fn, ms) => { const timer = { fn, ms, at: h.wall, cancelled: false, fired: false }; h.timers.push(timer); return timer; },
    clearTimer: timer => { if (timer) timer.cancelled = true; },
    timeout: () => { const controller = new AbortController(); h.timeouts.push(controller); return controller.signal; }
  });
  h.advance = ms => { h.wall += ms; h.mono += ms; };
  h.labels = () => h.updates.at(-1);
  h.pending = () => h.timers.filter(t => !t.cancelled && !t.fired);
  h.fire = async timer => { timer.fired = true; timer.fn(); await flush(); };
  return h;
}
const table = responses => async path => { const value = typeof responses === 'function' ? responses(path) : responses[path]; if (value instanceof Error) throw value; if (value === undefined) throw Error('unexpected ' + path); return structuredClone(value); };

test('snapshot validation binds schema, team and season and drops malformed or duplicate events', () => {
  const good = envelope(2026, [ev('101', G1, 'completed')]);
  assert.equal(validateStatusSnapshot(good, { teamId: '150', season: 2026 }).length, 1);
  for (const bad of [{ ...good, schemaVersion: 2 }, { ...good, teamId: '59' }, { ...good, season: 2025 }, { ...good, events: {} }, null])
    assert.throws(() => validateStatusSnapshot(bad, { teamId: '150', season: 2026 }));
  const events = [ev('101', G1, 'completed'), ev('102', G2, 'LIVE'), { ...ev('103', G2, 'live'), teamIds: ['59', '2390'] }, { ...ev('104', G2, 'live'), teams: ['Duke'] },
    { ...ev('105', G2, 'live'), start: '2026-10-10' }, { ...ev('106', G2, 'live'), season: 2025 }, { ...ev('107', G2, 'live'), teamIds: ['150', '150'] }, ev('108', G2, 'unknown'), ev('108', G2, 'upcoming'), ev('109', G2, 'live')];
  assert.deepEqual(validateStatusSnapshot(envelope(2026, events), { teamId: '150', season: 2026 }).map(e => [e.id, e.status]), [['101', 'completed'], ['109', 'live']]);
});
test('optional live scoreboard: a malformed board is dropped while its event and status stay valid', () => {
  const live = board => ({ ...ev('110', G2, 'live'), scoreboard: board });
  const good = { phase: 'in-progress', period: 2, clock: '7:29', scores: { 150: 14, 2390: 17 } };
  assert.deepEqual(validateScoreboard(good, ['150', '2390']), good);
  assert.deepEqual(validateScoreboard({ phase: 'halftime', period: 2 }, ['150', '2390']), { phase: 'halftime', period: 2 });
  assert.deepEqual(validateScoreboard({ phase: 'in-progress', period: 5 }, ['150', '2390']), { phase: 'in-progress', period: 5 });
  assert.deepEqual(validateScoreboard({ phase: 'in-progress', period: 4, clock: '0:00', scores: { 150: 0, 2390: 0 } }, ['150', '2390']).scores, { 150: 0, 2390: 0 });
  for (const bad of [null, [], 'live', {}, { phase: 'final' }, { ...good, extra: 1 }, { ...good, logo: 'https://a.espncdn.com/x.png' },
    { ...good, period: 0 }, { ...good, period: 100 }, { ...good, period: '2' }, { ...good, clock: '7:60' }, { ...good, clock: '15:01' }, { ...good, clock: ' 7:29' }, { ...good, clock: 449 },
    { phase: 'halftime', period: 2, clock: '0:00' }, { phase: 'in-progress', period: 5, clock: '5:00' }, { phase: 'in-progress', clock: '7:29' },
    { ...good, scores: { 150: 14 } }, { ...good, scores: { 150: 14, 2390: 17, 59: 3 } }, { ...good, scores: { 150: 14, 59: 17 } }, { ...good, scores: { 150: '14', 2390: 17 } },
    { ...good, scores: { 150: 14.5, 2390: 17 } }, { ...good, scores: { 150: -1, 2390: 17 } }, { ...good, scores: { 150: 1000, 2390: 17 } }, { ...good, scores: { 150: null, 2390: 17 } }, { ...good, scores: [14, 17] }])
    assert.equal(validateScoreboard(bad, ['150', '2390']), null, JSON.stringify(bad));
  const events = validateStatusSnapshot(envelope(2026, [live(good), { ...live({ ...good, clock: 'bad' }), id: '111' }, { ...ev('112', G1, 'completed'), scoreboard: good }]), { teamId: '150', season: 2026 });
  assert.deepEqual(events.map(e => [e.id, e.status, e.scoreboard]), [['110', 'live', good], ['111', 'live', undefined], ['112', 'completed', undefined]]);
  assert.ok(!('scoreboard' in events[1]) && !('scoreboard' in events[2]));
  assert.deepEqual(Object.keys(events[0]), ['id', 'start', 'teams', 'teamIds', 'season', 'status', 'scoreboard']);
});
test('gameMatches exposes the one-to-one event behind each label without changing labels', () => {
  const snapshot = events => new Map([[2026, { providerId: '150', events }]]);
  const events = [ev('101', G1, 'completed'), ev('102', G2, 'live')];
  assert.deepEqual([...gameMatches([G1, G2, G3], 'Duke', snapshot(events))].map(([id, e]) => [id, e?.id ?? null]), [['g1', '101'], ['g2', '102'], ['g3', null]]);
  const twin = { ...G2, id: 'g2-replay', start: G2.start + 3600 * 1000 };
  assert.deepEqual([...gameMatches([G2, twin], 'Duke', snapshot(events)).values()], [null, null], 'two catalog games cannot both claim one event');
  assert.equal(gameMatches([G2], 'Duke', snapshot([ev('102', G2, 'unknown')])).get('g2').id, '102', 'the match itself does not depend on the status label');
  assert.equal(gameStatuses([G2], 'Duke', snapshot([ev('102', G2, 'unknown')])).get('g2'), 'unavailable');
});
// Issue #44 kickoff confidence. See KICKOFF-TIMES.md for the source rule.
test('optional kickoff: confirmed and tbd are kept; any other value is dropped while its event and status stay valid', () => {
  const odd = ['TBD', 'provisional', true, null, ''];
  const events = validateStatusSnapshot(envelope(2026, [{ ...ev('101', G1, 'completed'), kickoff: 'confirmed' }, { ...ev('102', G2, 'unknown'), kickoff: 'tbd' },
    ...odd.map((kickoff, i) => ({ ...ev(String(103 + i), G2, 'upcoming'), kickoff })), ev('108', G2, 'upcoming')]), { teamId: '150', season: 2026 });
  assert.deepEqual(events.map(e => [e.id, e.status, e.kickoff]), [['101', 'completed', 'confirmed'], ['102', 'unknown', 'tbd'], ...odd.map((_, i) => [String(103 + i), 'upcoming', undefined]), ['108', 'upcoming', undefined]]);
  for (const event of events.slice(2)) assert.deepEqual(Object.keys(event), ['id', 'start', 'teams', 'teamIds', 'season', 'status']);
  const [live] = validateStatusSnapshot(envelope(2026, [{ ...ev('110', G2, 'live'), scoreboard: { phase: 'halftime', period: 2 }, kickoff: 'confirmed' }]), { teamId: '150', season: 2026 });
  assert.deepEqual(Object.keys(live), ['id', 'start', 'teams', 'teamIds', 'season', 'status', 'scoreboard', 'kickoff']);
});
test('gameKickoffs: tbd from a unique match; confirmed only at the exact catalog start; everything else absent', () => {
  const snapshot = events => new Map([[2026, { providerId: '150', events }]]);
  // Public Duke values: the catalog lists "Boston" at 12:34 PM EDT; the provider lists Boston College as TBD on its 04:00Z date.
  const BC = { id: 'bc', opponent: 'Boston', start: Date.parse('2026-10-31T16:34:00Z') };
  const tbd = { id: '401858279', start: Date.parse('2026-10-31T04:00:00Z'), teams: ['Duke', 'Boston College'], teamIds: ['150', '103'], season: 2026, status: 'upcoming', kickoff: 'tbd' };
  assert.deepEqual(Object.fromEntries(gameKickoffs([BC], 'Duke', snapshot([tbd]))), { bc: 'tbd' }, 'TBD does not need the start to agree');
  assert.equal(gameStatuses([BC], 'Duke', snapshot([tbd])).get('bc'), 'upcoming');
  const kickoffs = (games, events) => Object.fromEntries(gameKickoffs(games, 'Duke', snapshot(events)));
  const confirmed = (game, start = game.start) => ({ ...ev('102', game, 'upcoming', { start }), kickoff: 'confirmed' });
  assert.deepEqual(kickoffs([G2], [confirmed(G2)]), { g2: 'confirmed' });
  // SYNTHETIC: a legitimate 12:34 PM EST kickoff is an ordinary confirmed time.
  const G34 = { id: 'g34', opponent: 'Clemson', start: Date.parse('2026-11-21T17:34:00Z') };
  assert.deepEqual(kickoffs([G34], [confirmed(G34)]), { g34: 'confirmed' });
  assert.deepEqual(kickoffs([G2], [confirmed(G2, G2.start + 60000)]), {}, 'a confirmed provider time that differs from the catalog confirms nothing');
  assert.equal(gameStatuses([G2], 'Duke', snapshot([confirmed(G2, G2.start + 60000)])).get('g2'), 'upcoming', 'the mismatch leaves status alone');
  assert.deepEqual(kickoffs([G2], [{ ...ev('102', G2, 'unknown'), kickoff: 'tbd' }]), { g2: 'tbd' }, 'an unknown status keeps TBD');
  assert.deepEqual(kickoffs([G2], [ev('102', G2, 'upcoming')]), {}, 'a legacy event without kickoff');
  assert.deepEqual(kickoffs([G2], [{ ...ev('102', G2, 'upcoming'), kickoff: 'tbd' },{ ...ev('103', G2, 'upcoming', { start: G2.start + 3600000 }), kickoff: 'tbd' }]), {}, 'ambiguous provider events');
  assert.deepEqual(kickoffs([G2, { ...G2, id: 'g2-replay', start: G2.start + 3600000 }], [{ ...ev('102', G2, 'upcoming'), kickoff: 'tbd' }]), {}, 'duplicate catalog claims');
  assert.deepEqual(Object.fromEntries(gameKickoffs([G2], 'Duke', new Map())), {}, 'no fresh snapshot');
});
test('kickoff confidence publishes beside labels from the same fresh data; a confidence-only change republishes; stale data clears it', async () => {
  let kickoff = 'confirmed';
  const h = harness({ read: table(path => path === 'sync/status/150/2026' ? envelope(2026, [{ ...ev('102', G2, 'upcoming'), kickoff }]) : standard[path]) });
  h.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' });
  assert.deepEqual([h.labels(), h.kickoffs.at(-1)], [{ g2: UNAVAILABLE }, {}], 'nothing is confirmed before the first status');
  await flush();
  assert.deepEqual([h.labels(), h.kickoffs.at(-1)], [{ g2: 'Upcoming' }, { g2: 'confirmed' }]);
  const updates = h.updates.length;
  await h.fire(h.pending()[0]);
  assert.equal(h.updates.length, updates, 'unchanged labels and confidence are not republished');
  kickoff = 'tbd'; await h.fire(h.pending()[0]);
  assert.equal(h.updates.length, updates + 1, 'a confidence-only change republishes');
  assert.deepEqual([h.labels(), h.kickoffs.at(-1)], [{ g2: 'Upcoming' }, { g2: 'tbd' }]);
  for (let i = 0; i < 45; i++) { h.advance(1000); h.status.tick(); }
  assert.deepEqual([h.labels(), h.kickoffs.at(-1)], [{ g2: UNAVAILABLE }, {}], 'stale data confirms nothing');
  assert.equal(h.kickoffs.length, h.updates.length, 'every update carries both maps');
});
test('only the two most recent valid catalog seasons are tracked; January belongs to the prior season', () => {
  assert.deepEqual(statusSeasons([G1, G2, G3, G4, G5]), [2026, 2025]);
  assert.deepEqual(statusSeasons([G3, { id: 'x', start: Date.parse('2027-01-02T20:00:00Z') }]), [2026]);
  assert.deepEqual(statusSeasons([G3]), []);
});
test('matching is unique and one-to-one: kickoff, names, provider ID, ambiguity and duplicate claims fail closed', () => {
  const snapshot = events => new Map([[2026, { providerId: '150', events }]]);
  assert.deepEqual(Object.fromEntries(gameStatuses([G1, G2, G3], 'Duke', snapshot([ev('101', G1, 'completed'), ev('102', G2, 'live')]))), { g1: 'completed', g2: 'live', g3: 'unavailable' });
  const cases = [
    ['kickoff outside window', [G2], [ev('102', G2, 'live', { start: G2.start + 24 * 3600 * 1000 })]],
    ['school mismatch', [G2], [ev('102', G2, 'live', { school: 'Georgia Tech' })]],
    ['provider ID absent', [G2], [{ ...ev('102', G2, 'live'), teamIds: ['59', '2390'] }]],
    ['ambiguous provider events', [G2], [ev('102', G2, 'live'), ev('103', G2, 'live', { start: G2.start + 3600 * 1000 })]],
    ['unknown provider state', [G2], [ev('102', G2, 'unknown')]],
    ['duplicate catalog claims', [G2, { ...G2, id: 'g2-replay', start: G2.start + 3600 * 1000 }], [ev('102', G2, 'live')]],
    ['duplicate catalog IDs', [G2, G2], [ev('102', G2, 'live')]]
  ];
  for (const [name, games, events] of cases) assert.ok([...gameStatuses(games, 'Duke', snapshot(events)).values()].every(s => s === 'unavailable'), name);
  assert.equal(gameStatuses([G2], 'Duke', new Map()).get('g2'), 'unavailable');
});
test('all games are labeled before any response; one teams lookup and one request per tracked season; old seasons never requested', async () => {
  const h = harness({ read: table(standard) });
  h.status.setGames({ games: [G1, G2, G3, G4, G5], teamId: DUKE, school: 'Duke' });
  assert.deepEqual(h.updates[0], { g1: UNAVAILABLE, g2: UNAVAILABLE, g3: UNAVAILABLE, g4: UNAVAILABLE, g5: UNAVAILABLE });
  await flush();
  assert.deepEqual(h.calls.slice().sort(), ['sync/status/150/2025', 'sync/status/150/2026', 'sync/teams']);
  assert.deepEqual(h.labels(), { g1: 'Completed', g2: 'Upcoming', g3: UNAVAILABLE, g4: UNAVAILABLE, g5: 'LIVE' });
  assert.deepEqual(h.pending().map(t => t.ms), [15000, 15000]);
  for (const timer of h.pending()) await h.fire(timer);
  assert.deepEqual(h.calls.filter(p => p === 'sync/teams'), ['sync/teams'], 'provider identity list is cached for the lifecycle');
  h.status.stop(); h.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' }); await flush();
  assert.equal(h.calls.filter(p => p === 'sync/teams').length, 2, 'a new lifecycle resolves identity again');
});

// Nominal path through the real gateway: Date 10 s old with no Age (11 s with Date precision),
// a shared-cache hit 9.999 s old, a client request of r, and 15 s scheduled from completion.
async function cadence(requestMs, polls = 4) {
  let h; const stored = new Map(), pending = [], seen = [], completions = [];
  const schedule = { team: { id: '150' }, season: { year: 2026 }, events: [{ id: '401858255', date: '2026-10-10T19:30Z', season: { year: 2026 }, competitions: [{ id: '401858255', competitors: [{ id: '150', team: { id: '150', location: 'Duke' } }, { id: '2390', team: { id: '2390', location: 'Tulane' } }], status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } } }] }] };
  const cache = { match: async key => stored.get(key.url)?.clone(), put: async (key, response) => { stored.set(key.url, response); } };
  const gateway = async path => {
    const response = await metadataGateway(new Request(`https://gateway.example/api/${path}`), { cache, ctx: { waitUntil: p => pending.push(p) }, now: () => h.wall,
      fetcher: async () => Response.json(schedule, { headers: { Date: new Date(h.wall - 10000).toUTCString() } }) });
    await Promise.all(pending); assert.equal(response.status, 200); return response.json();
  };
  const step = ms => { while (ms > 0) { const d = Math.min(1000, ms); h.advance(d); ms -= d; h.status.tick(); seen.push(h.labels().g2); } };
  h = harness({ read: async path => { const data = await gateway(path); if (path.startsWith('sync/status/')) { step(requestMs); completions.push(h.wall); } return data; } });
  h.wall = h.mono = 1_000_999; // Every fill lands at .999 s: Date truncation is worst case (upstream age 11.999 s).
  await gateway('sync/status/150/2026'); // Another viewer fills the shared cache.
  h.advance(9999);
  h.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' }); await flush();
  assert.equal(h.labels().g2, 'Upcoming');
  const firstFresh = seen.length;
  for (let i = 1; i < polls; i++) {
    const [timer] = h.pending();
    assert.equal(timer.ms, 15000); assert.equal(timer.at, completions.at(-1), 'the next poll is scheduled from completion');
    step(5001); await gateway('sync/status/150/2026'); step(timer.ms - 5001); // Re-filled 9.999 s before our poll.
    await h.fire(timer);
  }
  assert.equal(completions.length, polls);
  return { after: seen.slice(firstFresh), h };
}
test('nominal successful polling keeps a continuous label (no flicker) across successive polls', async () => {
  const { after, h } = await cadence(3000);
  assert.ok(after.length > 50);
  assert.deepEqual([...new Set(after)], ['Upcoming']);
  assert.equal(h.labels().g2, 'Upcoming');
});
test('boundary companion: a 5 s request with the same ages expires before replacement, then recovers', async () => {
  const { after, h } = await cadence(5000);
  assert.ok(after.includes(UNAVAILABLE), 'slower delivery legitimately shows Status unavailable');
  assert.equal(h.labels().g2, 'Upcoming');
});
test('failure invalidates immediately, backs off 30/60/120 s from completion, and success resets to 15 s', async () => {
  let fail = false;
  const h = harness({ read: table(path => fail && path.startsWith('sync/status/') ? Error('502') : standard[path]) });
  h.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' }); await flush();
  assert.equal(h.labels().g2, 'Upcoming');
  fail = true;
  for (let i = 0; i < 4; i++) { await h.fire(h.pending()[0]); assert.equal(h.labels().g2, UNAVAILABLE); }
  fail = false; await h.fire(h.pending()[0]);
  assert.equal(h.labels().g2, 'Upcoming');
  assert.deepEqual(h.timers.map(t => t.ms), [15000, 30000, 60000, 120000, 120000, 15000]);
});
test('a hanging poll cannot extend a label: expiry ticks independently, no overlapping request, and timeout schedules retry', async () => {
  let hang = false;
  const h = harness({ read: async (path, options) => hang && path.startsWith('sync/status/') ? new Promise(() => {}) : table(standard)(path, options) });
  h.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' }); await flush();
  hang = true; h.advance(15000); await h.fire(h.pending()[0]);
  const requests = h.calls.length;
  for (let i = 0; i < 29; i++) { h.advance(1000); h.status.tick(); }
  assert.equal(h.labels().g2, 'Upcoming', '44 s old');
  h.advance(1000); h.status.tick();
  assert.equal(h.labels().g2, UNAVAILABLE, 'expires at 45 s while the request still hangs');
  assert.equal(h.calls.length, requests); assert.equal(h.pending().length, 0);
  h.timeouts.at(-1).abort(new DOMException('deadline', 'TimeoutError')); await flush();
  assert.deepEqual(h.pending().map(t => t.ms), [30000]);
});
test('unknown or malformed age and local clock steps produce Status unavailable', async () => {
  const h = harness({ read: table({ ...standard, 'sync/status/150/2026': envelope(2026, [ev('102', G2, 'upcoming')], { ageMs: null }) }) });
  h.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' }); await flush();
  assert.equal(h.labels().g2, UNAVAILABLE); assert.deepEqual(h.pending().map(t => t.ms), [15000]);
  const s = harness({ read: table(standard) });
  s.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' }); await flush();
  assert.equal(s.labels().g2, 'Upcoming');
  s.wall -= 5000; s.mono += 1000; s.status.tick();
  assert.equal(s.labels().g2, UNAVAILABLE, 'wall clock stepped backward');
  const old = harness({ read: table({ ...standard, 'sync/status/150/2026': envelope(2026, [ev('102', G2, 'upcoming')], { ageMs: 45000 }) }) });
  old.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' }); await flush();
  assert.equal(old.labels().g2, UNAVAILABLE);
});
test('suspend aborts in-flight reads and late data cannot relabel; resume reacquires immediately', async () => {
  let gate = deferred();
  const h = harness({ read: async (path, options) => path.startsWith('sync/status/') ? gate.promise : table(standard)(path, options) });
  h.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' }); await flush();
  const signal = h.signals.at(-1);
  h.status.suspend();
  assert.equal(signal.aborted, true); assert.equal(h.labels().g2, UNAVAILABLE); assert.equal(h.pending().length, 0);
  const updates = h.updates.length;
  gate.resolve(envelope(2026, [ev('102', G2, 'live')])); await flush();
  assert.equal(h.updates.length, updates); assert.equal(h.pending().length, 0);
  gate = deferred(); h.status.resume(); await flush();
  assert.equal(h.calls.filter(p => p.startsWith('sync/status/')).length, 2);
  h.status.resume(); await flush();
  assert.equal(h.calls.filter(p => p.startsWith('sync/status/')).length, 2, 'resume never overlaps an active poll');
  gate.resolve(envelope(2026, [ev('102', G2, 'live')])); await flush();
  assert.equal(h.labels().g2, 'LIVE');
});
test('catalog replacement and clear discard late results even for the same game ID', async () => {
  const gates = [];
  const h = harness({ read: async (path, options) => { if (!path.startsWith('sync/status/')) return table(standard)(path, options); const gate = deferred(); gates.push(gate); return gate.promise; } });
  h.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' }); await flush();
  h.status.setGames({ games: [G2], teamId: GT, school: 'Georgia Tech' }); await flush();
  assert.equal(h.calls.at(-1), 'sync/status/59/2026');
  gates[0].resolve(envelope(2026, [ev('102', G2, 'live')])); await flush();
  assert.equal(h.labels().g2, UNAVAILABLE);
  h.status.clear();
  const updates = h.updates.length;
  gates[1].resolve(envelope(2026, [ev('102', G2, 'live', { school: 'Georgia Tech', teamId: '59' })], { teamId: '59' })); await flush();
  assert.equal(h.updates.length, updates); assert.equal(h.pending().length, 0);
  h.status.tick(); assert.equal(h.updates.length, updates);
});
test('identity requires exact UUID and school; failed lookups retry and reacquire instead of wedging', async () => {
  let teams = Error('teams');
  const h = harness({ read: table(path => path === 'sync/teams' ? teams : standard[path]) });
  h.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' }); await flush();
  assert.deepEqual(h.calls, ['sync/teams']); assert.deepEqual(h.pending().map(t => t.ms), [30000]);
  teams = providerTeams; await h.fire(h.pending()[0]);
  assert.deepEqual(h.calls, ['sync/teams', 'sync/teams', 'sync/status/150/2026']); assert.equal(h.labels().g2, 'Upcoming');
  for (const [teamId, school, list] of [[DUKE, 'Duke Blue', providerTeams], [GT, 'Duke', providerTeams], [DUKE, 'Duke', [...providerTeams, providerTeams[0]]]]) {
    const m = harness({ read: table({ ...standard, 'sync/teams': list }) });
    m.status.setGames({ games: [G2], teamId, school }); await flush();
    assert.deepEqual(m.calls, ['sync/teams'], school); assert.equal(m.labels().g2, UNAVAILABLE);
  }
});
test('a hanging identity lookup is retired at the poll deadline: retries issue one new shared lookup and the late result cannot overwrite the cache', async () => {
  const lookups = [];
  const h = harness({ read: (path, options) => { if (path !== 'sync/teams') return table(standard)(path, options); const gate = deferred(); lookups.push(gate); return gate.promise; } });
  h.status.setGames({ games: [G2, G5], teamId: DUKE, school: 'Duke' }); await flush();
  assert.equal(lookups.length, 1, 'both seasons share one lookup');
  for (const deadline of h.timeouts.splice(0)) deadline.abort(new DOMException('deadline', 'TimeoutError'));
  await flush();
  assert.deepEqual(h.pending().map(t => t.ms), [30000, 30000]); assert.deepEqual(h.labels(), { g2: UNAVAILABLE, g5: UNAVAILABLE });
  for (const timer of h.pending()) await h.fire(timer);
  assert.equal(lookups.length, 2, 'the retry issues a new lookup instead of reusing the hung one, still shared by both seasons');
  lookups[1].resolve(structuredClone(providerTeams)); await flush();
  assert.deepEqual(h.labels(), { g2: 'Upcoming', g5: 'LIVE' });
  lookups[0].resolve([{ id: '59', name: 'Duke', homestreamId: DUKE }]); await flush();
  for (const timer of h.pending()) await h.fire(timer);
  assert.equal(lookups.length, 2, 'the cached identity is reused'); assert.deepEqual(h.calls.filter(p => p === 'sync/teams').length, 2);
  assert.deepEqual(h.calls.filter(p => p.startsWith('sync/status/')).sort(), ['sync/status/150/2025', 'sync/status/150/2025', 'sync/status/150/2026', 'sync/status/150/2026'], 'the late lookup never redirected identity to team 59');
  assert.deepEqual(h.labels(), { g2: 'Upcoming', g5: 'LIVE' });
});
test('a deadline on one season retires the shared lookup without wedging the other season', async () => {
  const lookups = [];
  const h = harness({ read: (path, options) => { if (path !== 'sync/teams') return table(standard)(path, options); const gate = deferred(); lookups.push(gate); return gate.promise; } });
  h.status.setGames({ games: [G2, G5], teamId: DUKE, school: 'Duke' }); await flush();
  h.timeouts[0].abort(new DOMException('deadline', 'TimeoutError')); await flush();
  const [retry] = h.pending(); assert.equal(retry.ms, 30000);
  await h.fire(retry);
  assert.equal(lookups.length, 2);
  lookups[1].resolve(structuredClone(providerTeams)); await flush();
  lookups[0].resolve(structuredClone(providerTeams)); await flush();
  assert.deepEqual(h.labels(), { g2: 'Upcoming', g5: 'LIVE' }, 'the season still awaiting the first lookup completes with its own result');
});
test('inactive or hidden controllers label without polling until enabled', async () => {
  let enabled = false;
  const h = harness({ read: table(standard), enabled: () => enabled });
  h.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' }); await flush();
  assert.equal(h.calls.length, 0); assert.equal(h.labels().g2, UNAVAILABLE);
  h.status.resume(); await flush(); assert.equal(h.calls.length, 0);
  enabled = true; h.status.resume(); await flush();
  assert.equal(h.labels().g2, 'Upcoming');
});
// initial(): one structured read for the default game (issue #39); labels keep their own contract.
const plainStates = map => Object.fromEntries(map);
const settled = promise => { let done = false, value; promise.then(v => { done = true; value = v; }); return () => (done ? value : undefined); };
test('initial() resolves once with structured fresh states after every season\'s first poll; later polls never resolve it again', async () => {
  const gates = new Map();
  const h = harness({ read: (path, options) => path.startsWith('sync/status/') ? (gates.set(path, deferred()), gates.get(path).promise) : table(standard)(path, options) });
  h.status.setGames({ games: [G1, G2, G3, G5], teamId: DUKE, school: 'Duke' });
  const first = settled(h.status.initial()); await flush();
  assert.equal(first(), undefined, 'waits for both seasons');
  gates.get('sync/status/150/2026').resolve(standard['sync/status/150/2026']); await flush();
  assert.equal(first(), undefined, 'one season is not the first round');
  gates.get('sync/status/150/2025').resolve(standard['sync/status/150/2025']); await flush();
  assert.deepEqual(plainStates(first()), { g1: 'completed', g2: 'upcoming', g3: 'unavailable', g5: 'live' }, 'states, never label text; a null start is never matched');
  assert.deepEqual(h.labels(), { g1: 'Completed', g2: 'Upcoming', g3: UNAVAILABLE, g5: 'LIVE' }, 'labels are unchanged');
  const later = settled(h.status.initial()); await flush();
  assert.deepEqual(plainStates(later()), plainStates(first()), 'after the first round a caller reads the current states at once');
});
test('initial() fails closed: stale, failed, unknown or ambiguous evidence reads unavailable', async () => {
  for (const [name, responses] of [['stale', { ...standard, 'sync/status/150/2026': envelope(2026, [ev('102', G2, 'live')], { ageMs: 45000 }) }],
    ['failed', { ...standard, 'sync/status/150/2026': Error('502') }], ['unknown', { ...standard, 'sync/status/150/2026': envelope(2026, [ev('102', G2, 'unknown')]) }],
    ['ambiguous', { ...standard, 'sync/status/150/2026': envelope(2026, [ev('102', G2, 'live'), ev('103', G2, 'live', { start: G2.start + 3600 * 1000 })]) }]]) {
    const h = harness({ read: table(responses) });
    h.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' });
    const result = settled(h.status.initial()); await flush();
    assert.deepEqual(plainStates(result()), { g2: 'unavailable' }, name);
  }
});
test('initial() settles promptly with no season, no catalog, a hidden controller, halt or caller abort; a hanging read keeps it pending for the caller to bound', async () => {
  const none = harness({ read: table(standard) });
  assert.deepEqual(plainStates(await none.status.initial()), {}, 'no catalog');
  none.status.setGames({ games: [G3], teamId: DUKE, school: 'Duke' });
  assert.deepEqual(plainStates(await none.status.initial()), { g3: 'unavailable' }, 'no season to poll');
  const hidden = harness({ read: table(standard), enabled: () => false });
  hidden.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' });
  assert.deepEqual(plainStates(await hidden.status.initial()), { g2: 'unavailable' }); assert.equal(hidden.calls.length, 0);
  for (const end of ['suspend', 'clear', 'setGames', 'abort']) {
    const h = harness({ read: (path, options) => path.startsWith('sync/status/') ? new Promise(() => {}) : table(standard)(path, options) });
    h.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' });
    const controller = new AbortController(), result = settled(h.status.initial(controller.signal)); await flush();
    assert.equal(result(), undefined, `${end}: an abort-insensitive read leaves it pending`);
    if (end === 'abort') controller.abort(); else if (end === 'setGames') h.status.setGames({ games: [G1], teamId: DUKE, school: 'Duke' }); else h.status[end]();
    await flush();
    assert.ok(result() instanceof Map, end); assert.ok([...result().values()].every(s => s === 'unavailable'), end);
  }
  const aborted = new AbortController(); aborted.abort();
  const h = harness({ read: table(standard) }); h.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' });
  assert.deepEqual(plainStates(await h.status.initial(aborted.signal)), { g2: 'unavailable' }, 'an already-aborted caller is answered at once');
});
test('initial() also settles when a hanging first poll reaches its own deadline', async () => {
  const h = harness({ read: (path, options) => path.startsWith('sync/status/') ? new Promise(() => {}) : table(standard)(path, options) });
  h.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' });
  const result = settled(h.status.initial()); await flush();
  assert.equal(result(), undefined);
  h.timeouts.at(-1).abort(new DOMException('deadline', 'TimeoutError')); await flush();
  assert.deepEqual(plainStates(result()), { g2: 'unavailable' }); assert.deepEqual(h.pending().map(t => t.ms), [30000]);
});
test('a throwing label consumer cannot stop polling', async () => {
  const h = harness({ read: table(standard), onUpdate: () => { throw Error('render'); } });
  h.status.setGames({ games: [G2], teamId: DUKE, school: 'Duke' }); await flush();
  assert.equal(h.labels().g2, 'Upcoming'); assert.deepEqual(h.pending().map(t => t.ms), [15000]);
});
