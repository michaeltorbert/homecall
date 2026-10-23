import { setupViews } from '../src/app-views.js';
// Real Homestream catalog + Listen owner wiring + status controller in one page; only I/O, timers, the
// player and the timing tools are fakes. Status labels are label-only: they never decide readiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { metadataURL, mediaURL, configuredGatewayOrigin, gatewayOptions } from '../src/gateway.js';
import * as mapping from '../src/sync-mapping.js';
import { createGameStatus } from '../src/game-status.js';
import { PlaybackMemory } from '../src/playback-memory.js';
import { SessionLog } from '../src/session-log.js';
import { teams } from '../src/teams.js';
import { createNowPlaying, nowPlayingArtwork } from '../src/now-playing.js';
import { createScoreboard } from '../src/scoreboard.js';
import { listenTeams, resolveSources, officialLink } from '../src/listen-sources.js';
import { createListenSession, failureKind } from '../src/listen-session.js';
import { TIMELINE_NOTICE, FALLBACK_NOTICE } from '../src/hls-timeline.js';
import * as shell from '../src/ui-shell.js';
import { applySchoolTheme } from '../src/school-theme.js';
import { defaultGame } from '../src/game-choice.js';
import { validateGames } from '../src/homestream.js';
import { createTeamPreferences } from '../src/team-preferences.js';
import { createBrowseCatalog } from '../src/browse-catalog.js';
globalThis.__GATEWAY_ORIGIN__ = 'https://gateway.example';
const strip = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/export function/g, 'function');
const homestreamSource = strip('../src/homestream-ui.js'), appSource = strip('../src/app.js');
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
  const h = { w, clock: { wall: 1_000_000, mono: 1_000_000 }, requests: [], probes: [], statusTimers: [], timeouts: [], revoked: [], intervals: [], statusSignals: [], held: [], ageMs: 0,
    statusFail: false, holdStatus: false, holdProbe: false, provider: { 150: { g1: 'completed', g2: 'upcoming', g3: 'upcoming' }, 59: { g1: 'completed', g2: 'live' } } };
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
    throw Error('unexpected ' + path);
  };
  class FakePlayer {
    constructor(update, event) { h.player = this; this.update = update; this.event = event; this.sequence = 0; this.epoch = 0; this.starts = 0; this.stops = 0; }
    start() { this.starts++; this.context = { state: 'running' }; this.audio = { paused: false }; return Promise.resolve(); }
    stop() { this.stops++; this.context = null; this.audio = null; }
    command() { return Promise.resolve({ result: 'applied', before: {}, after: {}, contextSeconds: 1 }); }
    resumeContext() { return Promise.resolve(); } timestampState() { return 'none'; } liveTarget() { return null; }
  }
  const clock = () => ({ ...h.clock });
  // Page timeouts are recorded and fire only on request (the 4-second default-game deadline among them).
  w.setTimeout = (fn, ms) => { const timer = { fn, ms, cancelled: false }; h.timeouts.push(timer); return timer; }; w.clearTimeout = timer => { if (timer) timer.cancelled = true; };
  // jsdom has no revokeObjectURL; the fake test tone's blob URL is recorded when Listen releases it.
  w.URL.revokeObjectURL = url => { h.revoked.push(url); };
  w.setInterval = (fn, ms) => { h.intervals.push({ fn, ms }); return h.intervals.length; };
  w.__GATEWAY_ORIGIN__ = 'https://gateway.example';
  Object.assign(w, {setupViews, AbortController, metadataURL, mediaURL, configuredGatewayOrigin, gatewayOptions, readJSON, PlaybackMemory, SessionLog, teams, Player: FakePlayer, demoURL: () => 'blob:demo', setupArchive: options => { h.archive = options; }, defaultGame,
    createNowPlaying, nowPlayingArtwork, createScoreboard, listenTeams, resolveSources, officialLink, createListenSession, failureKind, TIMELINE_NOTICE, FALLBACK_NOTICE, applySchoolTheme, ...shell, validateGames, createTeamPreferences, createBrowseCatalog,
    setupGameTiming: () => ({ start() {}, stop() {}, reset() {}, invalidate() {}, render() {} }),
    checkPlaylist: url => { h.probes.push({ url, labels: h.labels() }); if (!h.holdProbe) return Promise.resolve('ready'); const gate = deferred(); h.releaseProbe = () => gate.resolve('ready'); return gate.promise; },
    createBroadcastCountdown: () => ({ setSchool() {}, tick() {}, suspend() {}, resume() {}, stop() {} }), createGameStatus: options => createGameStatus({ ...options, clock, timeout: () => new AbortController().signal,
      setTimer: (fn, ms) => { const timer = { fn, ms, cancelled: false, fired: false }; h.statusTimers.push(timer); return timer; },
      clearTimer: timer => { if (timer) timer.cancelled = true; } }) });
  h.$ = id => w.document.getElementById(id);
  h.texts = () => [...h.$('game').options].map(o => o.textContent);
  h.labels = () => h.texts().map(text => text.split(' · ')[0]);
  w.eval(homestreamSource + ';window.setupHomestream=setupHomestream;');
  h.boot = () => w.eval(appSource);
  h.fireStatus = async () => { for (const timer of h.statusTimers.filter(x => !x.cancelled && !x.fired)) { timer.fired = true; timer.fn(); } await flush(); };
  h.tick = () => { for (const { fn, ms } of h.intervals) if (ms === 1000) fn(); };
  h.setVisibility = state => { Object.defineProperty(w.document, 'visibilityState', { value: state, configurable: true }); w.document.dispatchEvent(new w.Event('visibilitychange')); };
  // Everything a status update must leave untouched.
  h.state = () => ({ starts: h.player.starts, stops: h.player.stops, value: h.$('game').value, selected: h.$('game').selectedIndex, values: [...h.$('game').options].map(o => o.value),
    disabled: h.$('game').disabled, focus: w.document.activeElement?.id, play: h.$('connect').disabled, status: h.$('status').textContent, station: h.$('station').textContent,
    source: h.$('source-current').textContent, note: h.$('game-note').textContent, catalogReads: h.requests.filter(p => p.startsWith('homestream/games')).length, probes: h.probes.length });
  return h;
}
const U = 'Status unavailable';

// Deliberate change (issue #39): the default game now waits for the first status round, so the probe
// starts after fresh labels instead of before them. A label is still never feed readiness.
test('every Listen game option is labeled before the selected feed probe; a status label is never feed readiness', async t => {
  const h = harness(t); h.holdProbe = true;
  assert.equal(h.$('game').getAttribute('aria-describedby'), 'game-status-help');
  assert.match(h.$('game-status-help').textContent, /reported by the sports-data source/); assert.match(h.$('game-status-help').textContent, /do not mean a feed is published or playable/);
  assert.equal(h.$('game-status-help').getAttribute('role'), null, 'no live-region announcements for polls');
  h.boot(); await flush();
  assert.deepEqual(h.probes[0].labels, ['Completed', 'Upcoming', 'Upcoming'], 'the first status round settles before the default game is probed');
  assert.equal(h.$('game').value, 'g2', 'the next upcoming game, not the completed one');
  assert.deepEqual(h.labels(), ['Completed', 'Upcoming', 'Upcoming']);
  assert.match(h.texts()[2], /^Upcoming · .+ · vs Clemson$/);
  assert.match(h.texts()[1], /^Upcoming · .+ · vs Tulane$/);
  assert.equal(h.$('connect').disabled, true, 'a status label is not feed readiness: Play waits for the check');
  assert.equal(h.player.starts, 0);
  h.releaseProbe(); await flush();
  assert.equal(h.$('connect').disabled, false); assert.equal(h.$('source-current').textContent, '');
});
test('status updates and failures change labels only; audio, source, selection, focus and readiness are untouched', async t => {
  const h = harness(t); h.boot(); await flush();
  h.$('connect').click(); await flush();
  h.$('game').focus();
  const before = h.state();
  assert.deepEqual([before.starts, before.focus], [1, 'game']);
  h.provider[150].g2 = 'live'; await h.fireStatus();
  assert.deepEqual(h.labels(), ['Completed', 'LIVE', 'Upcoming']); assert.deepEqual(h.state(), before);
  h.statusFail = true; await h.fireStatus();
  assert.deepEqual(h.labels(), [U, U, U]); assert.deepEqual(h.state(), before);
  assert.ok(h.statusTimers.filter(x => !x.cancelled && !x.fired).every(x => x.ms === 30000));
  h.statusFail = false; await h.fireStatus();
  assert.deepEqual(h.labels(), ['Completed', 'LIVE', 'Upcoming']); assert.equal(h.player.starts, 1);
});
test('labels expire on the one-second Listen tick without any network completion', async t => {
  const h = harness(t); h.ageMs = 40000; h.boot(); await flush();
  assert.equal(h.labels()[1], 'Upcoming');
  const reads = h.requests.length;
  h.clock.wall += 4000; h.clock.mono += 4000; h.tick();
  assert.equal(h.labels()[1], 'Upcoming');
  h.clock.wall += 1000; h.clock.mono += 1000; h.tick();
  assert.deepEqual(h.labels(), [U, U, U]); assert.equal(h.requests.length, reads);
});
test('hidden tab aborts status and relabels unavailable; visible return reacquires immediately without restarting audio', async t => {
  const h = harness(t); h.boot(); await flush();
  h.$('connect').click(); await flush();
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
  assert.equal(h.player.starts, starts); assert.equal(h.player.stops, stops);
});
test('team change invalidates status; late data never labels the replacement catalog with the same game IDs', async t => {
  const h = harness(t); h.boot(); await flush();
  assert.deepEqual(h.labels(), ['Completed', 'Upcoming', 'Upcoming']);
  h.holdStatus = true; await h.fireStatus();
  const lateDuke = h.held.splice(0);
  h.$('team').value = 'gt'; h.$('team').onchange(); await flush();
  // Georgia Tech's default waits on its own first status round behind a neutral placeholder.
  assert.deepEqual([...h.$('game').options].map(o => o.value), ['', 'g1', 'g2']);
  assert.deepEqual(h.labels(), ['Finding the live or next game…', U, U]);
  for (const release of lateDuke) release();
  await flush(); assert.deepEqual(h.labels(), ['Finding the live or next game…', U, U], 'Duke results cannot label or choose Georgia Tech options');
  assert.equal(h.$('game').value, '');
  assert.ok(h.requests.some(p => /^sync\/status\/59\//.test(p)));
  for (const release of h.held.splice(0)) release();
  await flush(); assert.deepEqual(h.labels(), ['Completed', 'LIVE']); assert.equal(h.$('game').value, 'g2', 'its own LIVE game');
  h.$('team').value = 'miami'; h.$('team').onchange();
  assert.equal(h.statusTimers.filter(x => !x.cancelled && !x.fired).length, 0, 'a team without a catalog stops status work');
  assert.equal(h.$('game-panel').hidden, true);
});

// ---------- Default game through the real catalog, status controller and Listen owner (issue #39) ----------
const deadline = h => h.timeouts.filter(x => x.ms === 4000 && !x.cancelled);
// Duke boots with its status held, so the default is still deciding behind the neutral placeholder.
async function deciding(t) {
  const h = harness(t); h.holdStatus = true; h.boot(); await flush();
  assert.deepEqual([h.$('game').value, h.$('game').disabled, h.$('game-refresh').disabled, h.$('connect').disabled, h.probes.length], ['', false, true, true, 0]);
  assert.equal(h.$('game-note').textContent, 'Finding the live or next Duke game…'); assert.equal(deadline(h).length, 1);
  return h;
}
const release = async h => { for (const r of h.held.splice(0)) r(); await flush(); };
test('a fresh LIVE game beats a nearer completed and a nearer upcoming game; its feed is then probed and Play stays manual', async t => {
  const h = harness(t); h.provider[150] = { g1: 'live', g2: 'upcoming', g3: 'upcoming' }; h.boot(); await flush();
  assert.equal(h.$('game').value, 'g1'); assert.equal(h.probes.length, 1); assert.match(h.probes[0].url, /\/g1$/);
  assert.equal(h.player.starts, 0, 'no autoplay'); assert.equal(h.$('source-current').textContent, '');
});
test('when status cannot be read the deadline picks the next kickoff, says so, and Duke still names the network', async t => {
  const h = harness(t); h.statusFail = true; h.boot(); await flush();
  // A failed first round settles the wait at once; the 4-second deadline is only the upper bound.
  assert.equal(h.$('game').value, 'g2');
  assert.match(h.$('game-note').textContent, /^Live status could not be confirmed for the most recent game\. /);
  const late = harness(t); late.holdStatus = true; late.boot(); await flush();
  deadline(late)[0].fn(); await flush();
  assert.equal(late.$('game').value, 'g2'); assert.equal(late.probes.length, 1);
  await release(late); late.provider[150].g3 = 'live'; await late.fireStatus();
  assert.equal(late.$('game').value, 'g2', 'a late or later LIVE never reselects'); assert.equal(late.probes.length, 1);
});
test('ordinary polls and expiry after the default stay label-only, even when another game turns LIVE', async t => {
  const h = harness(t); h.boot(); await flush();
  assert.equal(h.$('game').value, 'g2'); h.$('game').focus();
  const before = h.state();
  h.provider[150].g3 = 'live'; await h.fireStatus();
  assert.deepEqual(h.labels(), ['Completed', 'Upcoming', 'LIVE']); assert.deepEqual(h.state(), before);
  h.clock.wall += 60000; h.clock.mono += 60000; h.tick(); assert.deepEqual(h.labels(), [U, U, U]); assert.deepEqual(h.state(), before);
});
test('Refresh games and the reconnect refresh keep the chosen game while the provider reports another LIVE', async t => {
  const h = harness(t); h.boot(); await flush();
  h.$('game').value = 'g1'; await h.$('game').onchange(); await flush();
  h.provider[150].g3 = 'live'; await h.fireStatus();
  await h.$('game-refresh').onclick(); await flush();
  assert.equal(h.$('game').value, 'g1', 'a manual past game survives Refresh');
  assert.equal(deadline(h).length, 0, 'no status wait on an explicit refresh');
  h.$('connect').click(); await flush(); assert.equal(h.player.starts, 1);
  h.$('menu-reconnect').click(); h.$('confirm-continue').click(); await flush();
  assert.equal(h.$('game').value, 'g1'); assert.equal(h.player.starts, 1, 'the refresh stops audio and waits for Play');
});
test('a Source choice during the wait retires the default: no game, probe, source reset or notice overwrite', async t => {
  const h = await deciding(t);
  h.$('feed').value = 'duke-wsjs'; h.$('feed').onchange();
  const notice = h.$('notice').textContent; assert.match(notice, /^Ready for .+Press Play/);
  await release(h);
  assert.deepEqual([h.$('game').value, h.probes.length, h.$('feed').value, h.$('notice').textContent, h.player.starts], ['', 0, 'duke-wsjs', notice, 0]);
  assert.equal(h.$('game-note').textContent, 'Choose a game to check its feed.');
  assert.equal(h.$('source-current').textContent, 'Affiliate station · coverage may change; check that you hear the broadcast you want. Manual source · chosen in Source');
  assert.deepEqual(h.labels().slice(1), ['Completed', 'Upcoming', 'Upcoming'], 'labels still arrive');
});
test('the test tone, a Recordings takeover or a manual game during the wait each retire the default; Stop never revives it', async t => {
  let h = await deciding(t);
  h.$('demo').click(); assert.equal(h.player.starts, 1);
  const stops = h.player.stops;
  await release(h);
  assert.deepEqual([h.$('game').value, h.probes.length, h.player.starts, h.player.stops, h.$('station').textContent], ['', 0, 1, stops, 'Timing demo · repeating tones'], 'the tone keeps playing');
  h.$('stop').click();
  assert.deepEqual([h.$('status').textContent, h.$('stop').disabled, h.revoked], ['Stopped', true, ['blob:demo']], 'Stop completes and releases the tone');
  deadline(h).forEach(x => x.fn()); h.provider[150].g2 = 'live'; await h.fireStatus();
  assert.deepEqual([h.$('game').value, h.probes.length], ['', 0], 'Stop does not resurrect the retired default');
  h = await deciding(t);
  h.archive.stopLive(); await release(h);
  assert.deepEqual([h.$('game').value, h.probes.length], ['', 0]);
  h = await deciding(t);
  h.$('game').value = 'g1'; await h.$('game').onchange(); await flush();
  assert.deepEqual([h.$('game').value, h.probes.length], ['g1', 1]);
  await release(h); deadline(h).forEach(x => x.fn()); await flush();
  assert.deepEqual([h.$('game').value, h.probes.length, h.$('game-note').textContent], ['g1', 1, 'Live playlist confirmed: this game feed is advancing.']);
});
test('a team change or hidden tab during the wait: late data cannot choose for the new school; hidden settles at once', async t => {
  let h = await deciding(t);
  h.$('team').value = 'vt'; h.$('team').onchange(); await release(h); deadline(h).forEach(x => x.fn()); await flush();
  assert.deepEqual([h.probes.length, h.$('game-panel').hidden, h.$('source-current').textContent], [0, true, '']);
  h = await deciding(t);
  h.setVisibility('hidden'); await flush();
  assert.equal(h.$('game').value, 'g2', 'a suspended first round settles the default without waiting for the deadline');
  assert.match(h.$('game-note').textContent, /^Live status could not be confirmed/); assert.equal(h.player.starts, 0);
});
