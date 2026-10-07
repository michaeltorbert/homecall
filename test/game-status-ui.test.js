// Real Homestream catalog + Sync wiring + status controller in one page; only I/O, timers and the player are fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { metadataURL, mediaURL } from '../src/gateway.js';
import { createTimingFreshness, nextPollDelay } from '../src/timing-freshness.js';
import * as mapping from '../src/sync-mapping.js';
import { createGameStatus } from '../src/game-status.js';
const strip = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export function', 'function');
const homestreamSource = strip('../src/homestream-ui.js'), syncSource = strip('../src/sync.js');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const DUKE = '2903e5f6-960e-4954-a3ec-f7754e78660f', GT = '410422f0-663f-4e3d-82e2-787d954ae29d', HOUR = 3600000, DAY = 24 * HOUR;
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness(t) {
  const dom = new JSDOM(html, { url: 'https://example.test/homecall/', runScripts: 'outside-only', pretendToBeVisual: true }), w = dom.window; t.after(() => w.close());
  const now = Date.now();
  const catalogs = {
    [DUKE]: [{ id: 'g1', opponent: 'Illinois', start: now - 30 * DAY }, { id: 'g2', opponent: 'Tulane', start: now + HOUR }, { id: 'g3', opponent: 'Clemson', start: now + 7 * DAY, url: null }],
    [GT]: [{ id: 'g1', opponent: 'Clemson', start: now - 30 * DAY }, { id: 'g2', opponent: 'Duke', start: now + HOUR }]
  };
  const h = { w, clock: { wall: 1_000_000, mono: 1_000_000 }, requests: [], probes: [], statusTimers: [], syncTimers: [], intervals: [], statusSignals: [], held: [], liveStops: 0, ageMs: 0,
    statusFail: false, holdStatus: false, holdProbe: false, playsFail: false, provider: { 150: { g1: 'completed', g2: 'upcoming', g3: 'upcoming' }, 59: { g1: 'completed', g2: 'live' } } };
  const events = teamId => (teamId === '150' ? catalogs[DUKE] : catalogs[GT]).map((g, i) => ({ id: `${teamId}${i}`, start: g.start, teams: [teamId === '150' ? 'Duke' : 'Georgia Tech', g.opponent], teamIds: [teamId, String(900 + i)], season: mapping.footballSeason(g.start), status: h.provider[teamId][g.id] }));
  const readJSON = async (url, { signal } = {}) => {
    const path = url.pathname.replace(/^\/api\//, ''); h.requests.push(path);
    if (path === 'homestream/teams') return [{ id: DUKE, name: 'Duke' }, { id: GT, name: 'Georgia Tech' }];
    const games = /^homestream\/games\/(.+)$/.exec(path);
    if (games) return catalogs[games[1]].map(g => ({ ...g, url: g.url === null ? null : `https://gateway.example/media/game/${games[1]}/${g.id}` }));
    if (path === 'sync/teams') return [{ id: '150', name: 'Duke', homestreamId: DUKE }, { id: '59', name: 'Georgia Tech', homestreamId: GT }];
    const status = /^sync\/status\/(\d+)\/(\d+)$/.exec(path);
    if (status) {
      h.statusSignals.push(signal);
      const build = () => { if (h.statusFail) throw Error('status'); return { schemaVersion: 1, teamId: status[1], season: Number(status[2]), checkedAt: 1, ageMs: h.ageMs, events: events(status[1]).filter(e => e.season === Number(status[2])) }; };
      if (!h.holdStatus) return build();
      const gate = deferred(); h.held.push(() => gate.resolve(build())); return gate.promise;
    }
    const schedule = /^sync\/schedule\/(\d+)\/\d+$/.exec(path);
    if (schedule) return events(schedule[1]);
    const plays = /^sync\/plays\/(\d+)$/.exec(path);
    if (plays) { if (h.playsFail) throw Error('plays'); const e = [...events('150'), ...events('59')].find(x => x.id === plays[1]); return { schemaVersion: 2, eventId: e.id, teamIds: e.teamIds, season: e.season, plays: [], conflict: false, checkedAt: 1, ageMs: 0 }; }
    throw Error('unexpected ' + path);
  };
  class FakePlayer { constructor() { h.player = this; this.active = false; this.starts = 0; this.stops = 0; } start() { this.active = true; this.starts++; } stop() { this.active = false; this.stops++; } timing() { return { utc: NaN, position: 0, ranges: [], spans: [] }; } seek() { return true; } live() { return true; } }
  const clock = () => ({ ...h.clock });
  w.setTimeout = (fn, ms) => { const timer = { fn, ms, cancelled: false }; h.syncTimers.push(timer); return timer; };
  w.clearTimeout = timer => { if (timer) timer.cancelled = true; };
  w.setInterval = fn => { h.intervals.push(fn); return h.intervals.length; };
  w.__GATEWAY_ORIGIN__ = 'https://gateway.example';
  Object.assign(w, { ...mapping, AbortController, metadataURL, mediaURL, readJSON, nextPollDelay, SyncPlayer: FakePlayer,
    checkPlaylist: url => { h.probes.push({ url, labels: h.labels() }); if (!h.holdProbe) return Promise.resolve('ready'); const gate = deferred(); h.releaseProbe = () => gate.resolve('ready'); return gate.promise; },
    browserTiming: async () => { throw Error('browser timing is not selected'); },
    createTimingFreshness: () => createTimingFreshness({ clock }),
    createGameStatus: options => createGameStatus({ ...options, clock, timeout: () => new AbortController().signal,
      setTimer: (fn, ms) => { const timer = { fn, ms, cancelled: false, fired: false }; h.statusTimers.push(timer); return timer; },
      clearTimer: timer => { if (timer) timer.cancelled = true; } }) });
  w.eval(homestreamSource + ';window.setupHomestream=setupHomestream;');
  w.eval(syncSource + ';window.setup=setupSync;');
  h.ui = w.setup({ stopLive: () => { h.liveStops++; } });
  h.$ = id => w.document.getElementById('sync-' + id);
  h.$('timing-source').value = 'gateway';
  h.texts = () => [...h.$('game').options].map(o => o.textContent);
  h.labels = () => h.texts().map(text => text.split(' · ')[0]);
  h.fireStatus = async () => { for (const timer of h.statusTimers.filter(x => !x.cancelled && !x.fired)) { timer.fired = true; timer.fn(); } await flush(); };
  h.fireSync = async () => { const timer = h.syncTimers.filter(x => !x.cancelled).at(-1); timer.cancelled = true; await timer.fn(); await flush(); };
  h.tick = () => { for (const fn of h.intervals) fn(); };
  h.setVisibility = state => { Object.defineProperty(w.document, 'visibilityState', { value: state, configurable: true }); w.document.dispatchEvent(new w.Event('visibilitychange')); };
  // Everything a status update must leave untouched.
  h.state = () => ({ starts: h.player.starts, stops: h.player.stops, active: h.player.active, liveStops: h.liveStops, offset: h.$('offset').value, source: h.$('timing-source').value,
    value: h.$('game').value, selected: h.$('game').selectedIndex, values: [...h.$('game').options].map(o => o.value), disabled: h.$('game').disabled, focus: w.document.activeElement?.id,
    play: h.$('play').disabled, apply: h.$('apply').disabled, title: h.$('title').textContent, note: h.$('game-note').textContent, mapping: h.$('mapping-note').textContent,
    catalogReads: h.requests.filter(p => p.startsWith('homestream/')).length, probes: h.probes.length, timingReads: h.requests.filter(p => /^sync\/(schedule|plays)\//.test(p)).length });
  return h;
}
const U = 'Status unavailable';

test('every Sync option is labeled before the selected feed probe; status-first text keeps date, opponent and feed notice', async t => {
  const h = harness(t); h.holdProbe = true;
  assert.equal(h.$('game').getAttribute('aria-describedby'), 'sync-game-status-help');
  assert.match(h.$('game-status-help').textContent, /reported by the sports-data source/);assert.match(h.$('game-status-help').textContent, /do not mean a feed is published or playable/);
  assert.equal(h.$('game-status-help').getAttribute('role'), null, 'no live-region announcements for polls');
  h.ui.activate(); await flush();
  assert.deepEqual(h.probes[0].labels, [U, U, U], 'labels exist before the probe starts');
  assert.deepEqual(h.labels(), ['Completed', 'Upcoming', 'Upcoming']);
  assert.match(h.texts()[2], /^Upcoming · .+ · vs Clemson · feed not published$/);
  assert.match(h.texts()[1], /^Upcoming · .+ · vs Tulane$/);
  assert.equal(h.$('play').disabled, true, 'a status label is not feed readiness');
  assert.equal(h.player.starts, 0);
  h.releaseProbe(); await flush();
  assert.equal(h.$('play').disabled, false);
});
test('status updates and status failures change labels only; audio, calibration, timing source, selection, focus and anchors are untouched', async t => {
  const h = harness(t);
  h.ui.activate(); await flush();
  h.$('play').click(); await flush();
  h.$('offset').value = '3'; h.$('offset').dispatchEvent(new h.w.Event('input'));
  h.$('game').focus();
  const before = h.state();
  assert.deepEqual([before.starts, before.active, before.liveStops, before.focus], [1, true, 1, 'sync-game']);
  h.provider[150].g2 = 'live'; await h.fireStatus();
  assert.deepEqual(h.labels(), ['Completed', 'LIVE', 'Upcoming']); assert.deepEqual(h.state(), before);
  h.statusFail = true; await h.fireStatus();
  assert.deepEqual(h.labels(), [U, U, U]); assert.deepEqual(h.state(), before);
  assert.ok(h.statusTimers.filter(x => !x.cancelled && !x.fired).every(x => x.ms === 30000));
  await h.fireSync(); // Timing polling continues independently of status failure.
  assert.deepEqual(h.labels(), [U, U, U]); assert.equal(h.player.active, true); assert.equal(h.$('offset').value, '3');
  h.statusFail = false; await h.fireStatus();
  assert.deepEqual(h.labels(), ['Completed', 'LIVE', 'Upcoming']);
  h.playsFail = true; await h.fireSync();
  assert.match(h.$('mapping-note').textContent, /could not refresh/);
  assert.deepEqual(h.labels(), ['Completed', 'LIVE', 'Upcoming'], 'a timing failure never changes status');
  assert.equal(h.player.starts, 1); assert.equal(h.player.active, true);
});
test('labels expire on the one-second Sync tick without any network completion', async t => {
  const h = harness(t); h.ageMs = 40000;
  h.ui.activate(); await flush();
  assert.equal(h.labels()[1], 'Upcoming');
  const reads = h.requests.length;
  h.clock.wall += 4000; h.clock.mono += 4000; h.tick();
  assert.equal(h.labels()[1], 'Upcoming');
  h.clock.wall += 1000; h.clock.mono += 1000; h.tick();
  assert.deepEqual(h.labels(), [U, U, U]); assert.equal(h.requests.length, reads);
});
test('hidden tab aborts status and relabels unavailable; visible return reacquires immediately without restarting audio', async t => {
  const h = harness(t);
  h.ui.activate(); await flush();
  h.$('play').click(); await flush();
  h.holdStatus = true; await h.fireStatus();
  const inFlight = h.statusSignals.at(-1), starts = h.player.starts, stops = h.player.stops;
  h.setVisibility('hidden');
  assert.equal(inFlight.aborted, true); assert.deepEqual(h.labels(), [U, U, U]);
  assert.equal(h.statusTimers.filter(x => !x.cancelled && !x.fired).length, 0);
  for (const release of h.held.splice(0)) release();
  await flush(); assert.deepEqual(h.labels(), [U, U, U], 'late hidden-tab data cannot relabel');
  h.holdStatus = false; const reads = h.statusSignals.length;
  h.setVisibility('visible'); await flush();
  assert.ok(h.statusSignals.length > reads); assert.deepEqual(h.labels(), ['Completed', 'Upcoming', 'Upcoming']);
  assert.equal(h.player.starts, starts); assert.equal(h.player.stops, stops); assert.equal(h.player.active, true);
});
test('team change and deactivation invalidate status; late data never labels the replacement catalog with the same game IDs', async t => {
  const h = harness(t);
  h.ui.activate(); await flush();
  assert.deepEqual(h.labels(), ['Completed', 'Upcoming', 'Upcoming']);
  h.holdStatus = true; await h.fireStatus();
  const lateDuke = h.held.splice(0);
  h.$('team').value = GT; h.$('team').dispatchEvent(new h.w.Event('change')); await flush();
  assert.deepEqual([...h.$('game').options].map(o => o.value), ['g1', 'g2']);
  assert.deepEqual(h.labels(), [U, U]);
  for (const release of lateDuke) release();
  await flush(); assert.deepEqual(h.labels(), [U, U], 'Duke results cannot label Georgia Tech options');
  assert.ok(h.requests.some(p => /^sync\/status\/59\//.test(p)));
  for (const release of h.held.splice(0)) release();
  await flush(); assert.deepEqual(h.labels(), ['Completed', 'LIVE']);
  await h.fireStatus();
  h.ui.deactivate();
  assert.equal(h.statusTimers.filter(x => !x.cancelled && !x.fired).length, 0);
  assert.deepEqual(h.labels(), [U, U]);
  for (const release of h.held.splice(0)) release();
  await flush(); h.tick();
  assert.deepEqual(h.labels(), [U, U], 'no status work after leaving Sync');
});
