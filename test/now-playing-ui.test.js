// Real consumers (app.js Live, Sync with the real Homestream catalog, Archive) wired to the real
// Now Playing publisher and scoreboard poller. Only I/O, timers, players and the platform
// MediaSession object are fakes. Browser API readback here is not OS, phone or car proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createNowPlaying, nowPlayingArtwork } from '../src/now-playing.js';
import { createScoreboard } from '../src/scoreboard.js';
import { PlaybackMemory } from '../src/playback-memory.js';
import { SessionLog } from '../src/session-log.js';
import { teams, getSources } from '../src/teams.js';
import { metadataURL, mediaURL, configuredGatewayOrigin, gatewayOptions } from '../src/gateway.js';
import { createTimingFreshness, nextPollDelay } from '../src/timing-freshness.js';
import * as mapping from '../src/sync-mapping.js';
import { createGameStatus } from '../src/game-status.js';
import { setupArchive } from '../src/archive.js';
import * as shell from '../src/ui-shell.js';
globalThis.__GATEWAY_ORIGIN__ = 'https://gateway.example';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const strip = file => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export function', 'function');
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const ART = 'https://example.test/homecall/now-playing/homecall-512.png';
const GT = '410422f0-663f-4e3d-82e2-787d954ae29d', DUKE = '2903e5f6-960e-4954-a3ec-f7754e78660f', HOUR = 3600000, DAY = 24 * HOUR;
const providerTeams = [{ id: '150', name: 'Duke', homestreamId: DUKE }, { id: '59', name: 'Georgia Tech', homestreamId: GT }];
function fakeMediaSession() {
  const ms = { writes: [], actions: [], positions: [], states: [], current: null };
  Object.defineProperty(ms, 'metadata', { get: () => ms.current, set: value => { ms.writes.push(value); ms.current = value; } });
  Object.defineProperty(ms, 'playbackState', { get: () => 'none', set: value => { ms.states.push(value); } });
  ms.setActionHandler = (...args) => { ms.actions.push(args); };
  ms.setPositionState = (...args) => { ms.positions.push(args); };
  return ms;
}
class FakeMetadata { constructor(init) { Object.assign(this, structuredClone(init)); } }
const noControls = ms => assert.deepEqual([ms.actions, ms.positions, ms.states], [[], [], []], 'no action handlers, position state or playback state writes');
// Synthetic live envelopes of the supported contract (not captured provider samples).
const statusEnvelope = (teamId, season, events, ageMs = 0) => ({ schemaVersion: 1, teamId, season, checkedAt: 1, ageMs, events });

// ---------- Live (src/app.js) ----------
const GT_GAME = { id: 'g2', opponent: 'Duke', start: Date.parse('2026-10-10T19:30:00Z'), url: 'https://gateway.example/media/game/gt/g2' };
const GT_GAMES = [{ id: 'g1', opponent: 'Clemson', start: Date.parse('2026-09-05T19:30:00Z') }, { id: 'g2', opponent: 'Duke', start: GT_GAME.start }];
const PLAYING = { delay: 0, available: 5, paused: false, holding: false, ingesting: true, restoring: null };
function live(t, { mediaSession = true } = {}) {
  const dom = new JSDOM(html, { url: 'https://example.test/homecall/', runScripts: 'outside-only' }), w = dom.window;
  t.after(() => w.close());
  const h = { w, ms: fakeMediaSession(), reads: [], timers: [], tickers: [], held: [], statusFail: false, holdStatus: false,
    status: () => statusEnvelope('59', 2026, [{ id: '401858255', start: GT_GAME.start, teams: ['Georgia Tech', 'Duke'], teamIds: ['59', '150'], season: 2026, status: 'live',
      scoreboard: { phase: 'in-progress', period: 2, clock: '7:29', scores: { 150: 14, 59: 17 } } }]) };
  class FakePlayer {
    constructor(update, event) { this.update = update; this.event = event; this.sequence = 0; this.epoch = 0; this.starts = []; h.player = this; }
    start(url, delay) { this.starts.push({ url, delay }); this.context = { state: 'running' }; this.audio = { paused: false }; if (this.failNext) { this.failNext = false; return Promise.reject(Error('source-error')); } return Promise.resolve(); }
    stop() { this.context = null; this.audio = null; }
    command() { return Promise.resolve({ result: 'applied', before: { delay: 0 }, after: { delay: 0 }, contextSeconds: 1 }); }
    resumeContext() { return Promise.resolve(); }
  }
  const readJSON = async (url, { signal } = {}) => {
    const path = url.pathname.replace(/^\/api\//, ''); h.reads.push(path);
    if (path === 'sync/teams') return structuredClone(providerTeams);
    if (/^sync\/status\//.test(path)) {
      if (h.statusFail) throw Error('status unavailable');
      if (!h.holdStatus) return h.status();
      const gate = deferred(); h.held.push(() => gate.resolve(h.status())); return gate.promise;
    }
    throw Error('unexpected ' + path);
  };
  const catalogFactory = callbacks => ({ ready: null, stop() {},
    setEnabled(value) { callbacks.onCatalogInvalidated(); this.ready = null; if (value) { callbacks.onGames(GT_GAMES, { teamId: GT }); this.ready = GT_GAME; } },
    async refresh() { callbacks.onChange(); callbacks.onReady(); } });
  w.setTimeout = (fn, ms) => { const timer = { fn, ms, cancelled: false }; h.timers.push(timer); return timer; };
  w.clearTimeout = timer => { if (timer) timer.cancelled = true; };
  w.setInterval = (fn, ms) => { const ticker = { fn, ms, cancelled: false }; h.tickers.push(ticker); return ticker; };
  w.clearInterval = ticker => { if (ticker) ticker.cancelled = true; };
  if (mediaSession) { Object.defineProperty(w.navigator, 'mediaSession', { value: h.ms, configurable: true }); w.MediaMetadata = FakeMetadata; }
  w.URL.revokeObjectURL = () => {};
  Object.assign(w, { setupSync: options => { h.syncOptions = options; return {}; }, setupArchive: options => { h.archiveOptions = options; }, setupHomestream: catalogFactory,
    PlaybackMemory, SessionLog, teams, getSources, Player: FakePlayer, demoURL: () => 'blob:demo', createNowPlaying, nowPlayingArtwork, createScoreboard, readJSON, metadataURL, configuredGatewayOrigin, gatewayOptions, ...shell });
  w.eval(strip('../src/app.js'));
  h.$ = id => w.document.getElementById(id);
  // Changing an active session's team or source now asks first; Continue applies the original change.
  h.proceed = () => h.$('confirm-continue').click();
  h.selectGT = () => { h.$('team').value = 'gt'; h.$('team').onchange(); };
  h.statusReads = () => h.reads.filter(p => p.startsWith('sync/status/')).length;
  h.tick = () => { for (const ticker of h.tickers.filter(x => !x.cancelled && x.ms === 1000)) ticker.fn(); };
  h.firePoll = async () => { const timer = h.timers.filter(x => !x.cancelled && !x.fired && x.ms >= 15000).at(-1); timer.fired = true; timer.fn(); await flush(); };
  h.meta = () => h.ms.metadata && { title: h.ms.metadata.title, artist: h.ms.metadata.artist, album: h.ms.metadata.album, art: h.ms.metadata.artwork.map(a => `${a.src} ${a.sizes} ${a.type}`) };
  return h;
}
const SCORE = /^Live · ESPN data received .+ · Georgia Tech 17, Duke 14 · Q2 7:29$/;

test('Live GT: browsing never claims; Play freezes identity; score appears only while PCM output plays and strips on every non-playing state', async t => {
  const h = live(t);
  h.selectGT();
  assert.equal(h.ms.writes.length, 0, 'team browsing and catalog readiness never claim');
  h.$('connect').click();
  assert.deepEqual(h.meta(), { title: 'Georgia Tech vs Duke', artist: 'Homecall · Live game', album: 'Georgia Tech · Homestream', art: [`${ART} 512x512 image/png`] });
  await flush();
  assert.equal(h.statusReads(), 0, 'connected but no PCM output state yet');
  h.player.update(PLAYING); await flush();
  assert.match(h.ms.metadata.title, SCORE);
  assert.equal(h.ms.metadata.artist, 'Georgia Tech vs Duke · Homecall Live game');
  assert.deepEqual(h.reads.slice(0, 2), ['sync/teams', 'sync/status/59/2026']);
  for (const [name, change, restore] of [
    ['pause', () => h.player.update({ ...PLAYING, paused: true }), () => h.player.update(PLAYING)],
    ['hold', () => h.player.update({ ...PLAYING, holding: true }), () => h.player.update(PLAYING)],
    ['restoring', () => h.player.update({ ...PLAYING, restoring: 35 }), () => h.player.update(PLAYING)],
    ['context interruption', () => { h.player.context.state = 'suspended'; h.player.event('context-interrupted'); }, () => { h.player.context.state = 'running'; h.player.event('context-restored'); }],
    ['element pause', () => { h.player.audio.paused = true; h.player.event('source-paused'); }, () => { h.player.audio.paused = false; h.player.event('source-playing'); h.player.update(PLAYING); }],
    ['internal reconnect', () => h.player.event('source-reconnecting'), () => { h.player.event('source-reconnected'); h.player.update(PLAYING); }]
  ]) {
    const reads = h.statusReads();
    change();
    assert.deepEqual(h.meta(), { title: 'Georgia Tech vs Duke', artist: 'Homecall · Live game', album: 'Georgia Tech · Homestream', art: [`${ART} 512x512 image/png`] }, name);
    for (let i = 0; i < 20; i++) h.tick();
    await flush();
    assert.equal(h.statusReads(), reads, `${name}: no polling while output is not playing`);
    restore(); await flush();
    assert.equal(h.statusReads(), reads + 1, `${name}: returning to playback polls immediately`);
    assert.match(h.ms.metadata.title, SCORE, name);
  }
  h.$('stop').click();
  assert.equal(h.ms.metadata, null);
  noControls(h.ms);
});
test('Live input buffering alone keeps the score while delayed PCM output continues', async t => {
  const h = live(t);
  h.selectGT(); h.$('connect').click(); await flush();
  h.player.update(PLAYING); await flush();
  h.player.event('source-waiting'); h.player.update({ ...PLAYING, ingesting: false });
  assert.match(h.ms.metadata.title, SCORE);
});
test('Live late results and every terminal path release; a superseded session cannot republish', async t => {
  const h = live(t);
  h.selectGT(); h.$('connect').click(); await flush();
  h.holdStatus = true; h.player.update(PLAYING); await flush();
  h.$('stop').click();
  assert.equal(h.ms.metadata, null);
  for (const release of h.held.splice(0)) release();
  await flush();
  assert.equal(h.ms.metadata, null, 'a late result after Stop cannot republish');
  h.holdStatus = false;
  h.$('connect').click(); await flush(); h.player.update(PLAYING); await flush();
  assert.match(h.ms.metadata.title, SCORE);
  h.player.event('source-reconnect-required'); h.player.update(null);
  assert.equal(h.ms.metadata, null, 'player-reported terminal state releases');
  h.player.failNext = true; h.$('connect').click();
  assert.equal(h.ms.metadata.title, 'Georgia Tech vs Duke', 'claimed on the playback intent');
  await flush();
  assert.equal(h.ms.metadata, null, 'a failed start releases');
  h.$('connect').click(); await flush(); h.player.update(PLAYING); await flush();
  h.holdStatus = true; await h.firePoll();
  h.$('team').value = 'duke'; h.$('team').onchange();
  assert.notEqual(h.ms.metadata, null, 'a pending team prompt changes nothing');
  h.proceed();
  assert.equal(h.ms.metadata, null, 'changing team releases');
  for (const release of h.held.splice(0)) release();
  await flush();
  assert.equal(h.ms.metadata, null);
  noControls(h.ms);
});
test('Live status failure only removes volatile data; audio keeps playing', async t => {
  const h = live(t);
  h.selectGT(); h.$('connect').click(); await flush();
  h.player.update(PLAYING); await flush();
  assert.match(h.ms.metadata.title, SCORE);
  h.statusFail = true; await h.firePoll();
  assert.equal(h.ms.metadata.title, 'Georgia Tech vs Duke');
  assert.equal(h.player.starts.length, 1); assert.equal(h.$('stop').disabled, false); assert.notEqual(h.$('status').textContent, 'Disconnected');
  assert.equal(h.timers.filter(x => !x.cancelled && !x.fired).at(-1).ms, 30000);
  h.statusFail = false; await h.firePoll();
  assert.match(h.ms.metadata.title, SCORE);
});
test('Live radio, affiliates and the demo publish station or test-tone identity only, even while a live event exists', async t => {
  const h = live(t);
  assert.equal(h.ms.writes.length, 0);
  h.$('connect').click(); await flush();
  h.player.update(PLAYING);
  for (let i = 0; i < 30; i++) h.tick();
  await flush();
  assert.deepEqual(h.meta(), { title: 'Duke Sports Network', artist: 'Homecall · Live radio', album: 'Duke', art: [`${ART} 512x512 image/png`] });
  assert.equal(h.reads.length, 0, 'no game is guessed for radio, so no status is read');
  h.$('feed').value = 'duke-wsjs'; h.$('feed').onchange(); h.proceed();
  assert.equal(h.ms.metadata, null, 'changing feed stops and releases');
  h.$('connect').click(); await flush();
  assert.equal(h.ms.metadata.title, 'WSJS · Duke affiliate');
  for (const [key, title] of [['miami', '104.3 WQAM'], ['vt', 'Virginia Tech Sports Network']]) {
    h.$('team').value = key; h.$('team').onchange(); h.proceed(); h.$('connect').click(); await flush(); h.player.update(PLAYING); await flush();
    assert.equal(h.ms.metadata.title, title); assert.equal(h.ms.metadata.artist, 'Homecall · Live radio');
  }
  h.$('demo').click(); await flush();
  assert.deepEqual(h.meta(), { title: 'Timing demo · repeating tones', artist: 'Homecall · Timing demo', album: 'Homecall', art: [`${ART} 512x512 image/png`] });
  assert.equal(h.reads.length, 0);
  noControls(h.ms);
});
test('one application publisher is shared with Sync and Archive; a superseded Live owner never clears the newer claim', async t => {
  const h = live(t);
  assert.equal(h.syncOptions.nowPlaying, h.archiveOptions.nowPlaying);
  assert.equal(typeof h.syncOptions.scoreboard.start, 'function');
  h.$('connect').click(); await flush();
  const sync = h.syncOptions.nowPlaying.claim({ mode: 'sync', school: 'Duke', opponent: 'Tulane' });
  assert.equal(h.ms.metadata.title, 'Duke vs Tulane');
  h.player.update(null); h.$('stop').click();
  assert.equal(h.ms.metadata.title, 'Duke vs Tulane');
  assert.equal(sync.release(), true); assert.equal(h.ms.metadata, null);
});

test('a superseded Live session stops polling even while its old audio state still looks eligible', async t => {
  const h = live(t);
  h.selectGT(); h.$('connect').click(); await flush();
  h.player.update(PLAYING); await flush();
  assert.match(h.ms.metadata.title, SCORE);
  const other = h.syncOptions.nowPlaying.claim({ mode: 'sync', school: 'Duke', opponent: 'Tulane' });
  h.tick();
  assert.equal(h.timers.filter(x => !x.cancelled && !x.fired).length, 0, 'the old poller halts on the next watchdog tick');
  const reads = h.statusReads();
  h.player.update(PLAYING);
  for (let i = 0; i < 60; i++) h.tick();
  await flush();
  assert.equal(h.statusReads(), reads, 'Live audio still reports PCM output, but it no longer owns Now Playing');
  assert.equal(h.ms.metadata.title, 'Duke vs Tulane');
  assert.equal(other.current, true);
});
test('without a Media Session API no scoreboard requests are made and audio is unchanged', async t => {
  const h = live(t, { mediaSession: false });
  h.selectGT(); h.$('connect').click(); await flush();
  h.player.update(PLAYING);
  for (let i = 0; i < 30; i++) h.tick();
  await flush();
  assert.equal(h.reads.length, 0); assert.equal(h.ms.writes.length, 0);
  assert.equal(h.player.starts.length, 1); assert.equal(h.$('stop').disabled, false);
});

// ---------- Sync (src/sync.js + src/homestream-ui.js) ----------
function syncHarness(t, { prompt = false, liveActive = () => false } = {}) {
  const dom = new JSDOM(html, { url: 'https://example.test/homecall/', runScripts: 'outside-only', pretendToBeVisual: true }), w = dom.window;
  t.after(() => w.close());
  const now = Date.now();
  const games = [{ id: 'g1', opponent: 'Illinois', start: now - 30 * DAY }, { id: 'g2', opponent: 'Tulane', start: now + HOUR }];
  const h = { w, ms: fakeMediaSession(), clock: { wall: 1_000_000, mono: 1_000_000 }, boardReads: [], boardTimers: [], held: [], liveStops: 0, audioPaused: false, audioEnded: false, statusFail: false, holdBoard: false };
  const events = () => games.map((g, i) => ({ id: `15${i}`, start: g.start, teams: ['Duke', g.opponent], teamIds: ['150', String(900 + i)], season: mapping.footballSeason(g.start),
    status: i === 1 ? 'live' : 'completed', ...(i === 1 ? { scoreboard: { phase: 'in-progress', period: 2, clock: '7:29', scores: { 150: 14, 901: 17 } } } : {}) }));
  const readJSON = async url => {
    const path = url.pathname.replace(/^\/api\//, '');
    if (path === 'homestream/teams') return [{ id: DUKE, name: 'Duke' }, { id: GT, name: 'Georgia Tech' }];
    if (path === `homestream/games/${DUKE}`) return games.map(g => ({ ...g, url: `https://gateway.example/media/game/${DUKE}/${g.id}` }));
    if (path === 'sync/teams') return structuredClone(providerTeams);
    const status = /^sync\/status\/(\d+)\/(\d+)$/.exec(path);
    if (status) { if (h.statusFail) throw Error('status'); return statusEnvelope(status[1], Number(status[2]), events().filter(e => e.season === Number(status[2]))); }
    throw Error('unexpected ' + path);
  };
  class FakePlayer {
    constructor(audio, onStatus, options = {}) { h.player = this; this.active = false; this.starts = 0; this.onRecovery = options.onRecovery; }
    start() { this.active = true; this.starts++; } stop() { this.active = false; }
    timing() { return { utc: NaN, position: 0, ranges: [], spans: [] }; } seek() { return true; } live() { return true; }
  }
  const clock = () => ({ ...h.clock });
  w.setTimeout = fn => ({ fn, cancelled: false }); w.clearTimeout = timer => { if (timer) timer.cancelled = true; };
  w.setInterval = () => 0;
  w.__GATEWAY_ORIGIN__ = 'https://gateway.example';
  Object.assign(w, { ...mapping, AbortController, metadataURL, mediaURL, readJSON, nextPollDelay, SyncPlayer: FakePlayer,
    checkPlaylist: () => Promise.resolve('ready'), browserTiming: async () => { throw Error('not selected'); },
    createTimingFreshness: () => createTimingFreshness({ clock }),
    createGameStatus: options => createGameStatus({ ...options, clock, timeout: () => new AbortController().signal, setTimer: () => null, clearTimer: () => {} }) });
  w.eval(strip('../src/homestream-ui.js') + ';window.setupHomestream=setupHomestream;');
  w.eval(strip('../src/sync.js') + ';window.setup=setupSync;');
  h.np = createNowPlaying({ mediaSession: h.ms, MediaMetadata: FakeMetadata, artwork: nowPlayingArtwork(w.document.baseURI), formatTime: () => '10/7, 3:41 PM' });
  h.board = createScoreboard({
    read: (path, options) => {
      h.boardReads.push(path);
      if (h.holdBoard && path.startsWith('sync/status/')) { const gate = deferred(); h.held.push(() => gate.resolve(readJSON(new URL(`https://gateway.example/api/${path}`)))); return gate.promise; }
      return readJSON(new URL(`https://gateway.example/api/${path}`), options);
    },
    clock, now: () => h.clock.wall, timeout: () => new AbortController().signal,
    setTimer: (fn, ms) => { const timer = { fn, ms, cancelled: false, fired: false }; h.boardTimers.push(timer); return timer; }, clearTimer: timer => { if (timer) timer.cancelled = true; },
    setTicker: () => ({}), clearTicker: () => {}, window: w, document: w.document });
  h.audio = w.document.getElementById('sync-audio');
  Object.defineProperty(h.audio, 'paused', { get: () => h.audioPaused, configurable: true });
  Object.defineProperty(h.audio, 'ended', { get: () => h.audioEnded, configurable: true });
  h.ui = w.setup({ stopLive: () => { h.liveStops++; }, liveActive, confirm: prompt ? shell.createConfirm(w.document) : null, nowPlaying: h.np, scoreboard: h.board });
  h.$ = id => w.document.getElementById('sync-' + id);
  h.prompt = () => w.document.getElementById('confirm-dialog').hasAttribute('open');
  h.proceed = () => w.document.getElementById('confirm-continue').click();
  h.dismiss = () => w.document.getElementById('confirm-cancel').click();
  h.$('timing-source').value = '';
  h.statusReads = () => h.boardReads.filter(p => p.startsWith('sync/status/')).length;
  h.fireBoard = async () => { const timer = h.boardTimers.filter(x => !x.cancelled && !x.fired).at(-1); timer.fired = true; timer.fn(); await flush(); };
  h.emit = type => h.audio.dispatchEvent(new w.Event(type));
  return h;
}
const SYNC_SCORE = 'Live · ESPN data received 10/7, 3:41 PM · Duke 14, Tulane 17 · Q2 7:29';

test('Sync claims only on Play, before the player starts; pause and end keep the static identity; playback return refreshes immediately', async t => {
  const h = syncHarness(t);
  h.ui.activate(); await flush();
  assert.equal(h.ms.writes.length, 0, 'browsing, feed readiness and status labels never claim');
  assert.equal(h.statusReads(), 0, 'no session poller before Play');
  assert.equal(h.liveStops, 0);
  const start = h.player.start;
  h.player.start = function (url) { assert.equal(h.ms.metadata?.title, 'Duke vs Tulane', 'claimed before player.start'); return start.call(this, url); };
  h.$('play').click();
  assert.equal(h.liveStops, 1);
  await flush();
  assert.equal(h.ms.metadata.title, SYNC_SCORE);
  assert.equal(h.ms.metadata.artist, 'Duke vs Tulane · Homecall Sync game');
  assert.deepEqual(h.ms.metadata.artwork, [{ src: ART, sizes: '512x512', type: 'image/png' }]);
  h.audioPaused = true; h.emit('pause');
  assert.equal(h.ms.metadata.title, 'Duke vs Tulane', 'pause strips volatile data at once');
  let reads = h.statusReads();
  h.audioPaused = false; h.emit('playing'); await flush();
  assert.equal(h.statusReads(), reads + 1); assert.equal(h.ms.metadata.title, SYNC_SCORE);
  h.audioEnded = true; h.emit('ended');
  assert.equal(h.ms.metadata.title, 'Duke vs Tulane', 'media end keeps the identity for native replay');
  reads = h.statusReads();
  h.audioEnded = false; h.emit('playing'); await flush();
  assert.equal(h.statusReads(), reads + 1); assert.equal(h.ms.metadata.title, SYNC_SCORE, 'a valid replay is enriched again');
  noControls(h.ms);
});
test('Sync reconnect invalidates the scoreboard without forgetting the session; terminal stop, Stop and leaving Sync release', async t => {
  const h = syncHarness(t);
  h.ui.activate(); await flush();
  h.$('play').click(); await flush();
  assert.equal(h.ms.metadata.title, SYNC_SCORE);
  h.audioPaused = true; h.player.onRecovery({ type: 'reconnecting' });
  assert.equal(h.ms.metadata.title, 'Duke vs Tulane');
  const reads = h.statusReads();
  await flush(); assert.equal(h.statusReads(), reads, 'no volatile data during backoff');
  h.audioPaused = false; h.emit('playing'); await flush();
  assert.equal(h.statusReads(), reads + 1, 'requires a fresh provider response'); assert.equal(h.ms.metadata.title, SYNC_SCORE);
  h.player.onRecovery({ type: 'fallback', reason: 'no-sample' });
  assert.equal(h.ms.metadata.title, SYNC_SCORE, 'restoration outcomes do not touch metadata');
  h.player.active = false; h.player.onRecovery({ type: 'stopped' });
  assert.equal(h.ms.metadata, null); assert.equal(h.board.active, false);
  h.$('play').click(); await flush();
  assert.equal(h.ms.metadata.title, SYNC_SCORE);
  h.$('stop').click();
  assert.equal(h.ms.metadata, null);
  h.$('play').click(); await flush();
  h.ui.deactivate();
  assert.equal(h.ms.metadata, null, 'leaving Sync stops its audio and releases');
  noControls(h.ms);
});
test('Sync terminal stop reported synchronously by player.start leaves nothing published', async t => {
  const h = syncHarness(t);
  h.ui.activate(); await flush();
  h.player.start = function () { this.active = false; this.onRecovery({ type: 'stopped' }); };
  h.$('play').click(); await flush();
  assert.equal(h.ms.metadata, null); assert.equal(h.board.active, false); assert.equal(h.statusReads(), 0);
});
test('Sync status failure never stops audio; late results after Stop cannot republish', async t => {
  const h = syncHarness(t);
  h.ui.activate(); await flush();
  h.$('play').click(); await flush();
  h.statusFail = true; await h.fireBoard();
  assert.equal(h.ms.metadata.title, 'Duke vs Tulane');
  assert.equal(h.player.active, true); assert.equal(h.player.starts, 1);
  h.statusFail = false; h.holdBoard = true; await h.fireBoard();
  h.$('stop').click();
  for (const release of h.held.splice(0)) release();
  await flush();
  assert.equal(h.ms.metadata, null);
});

test('a superseded Sync session stops polling even though its audio keeps playing', async t => {
  const h = syncHarness(t);
  h.ui.activate(); await flush();
  h.$('play').click(); await flush();
  assert.equal(h.ms.metadata.title, SYNC_SCORE);
  h.np.claim({ mode: 'archive', school: 'Duke', opponent: 'Tulane' });
  h.emit('playing');
  assert.equal(h.boardTimers.filter(x => !x.cancelled && !x.fired).length, 0, 'the old poller halts');
  const reads = h.statusReads();
  h.emit('playing'); await flush();
  assert.equal(h.statusReads(), reads);
  assert.equal(h.ms.metadata.title, 'Duke vs Tulane'); assert.equal(h.ms.metadata.artist, 'Homecall · Archive recording');
  assert.equal(h.player.active, true, 'audio itself is untouched');
});

test('Sync radio takeover, game change and refresh ask first; Cancel keeps audio, identity and the committed game', async t => {
  let radio = true;
  const h = syncHarness(t, { prompt: true, liveActive: () => radio });
  h.ui.activate(); await flush();
  h.$('play').click();
  assert.equal(h.prompt(), true); assert.equal(h.liveStops, 0); assert.equal(h.player.starts, 0); assert.equal(h.ms.writes.length, 0, 'no claim before Continue');
  h.dismiss(); assert.equal(h.player.starts, 0); assert.equal(h.liveStops, 0);
  h.$('play').click(); h.proceed();
  assert.equal(h.liveStops, 1); assert.equal(h.player.starts, 1, 'Continue starts the broadcast inside its own click');
  radio = false; await flush();
  const title = h.ms.metadata.title;
  h.$('game').value = 'g1'; h.$('game').dispatchEvent(new h.w.Event('change'));
  assert.equal(h.prompt(), true); assert.equal(h.$('game').value, 'g2', 'the committed game stays selected while asking');
  h.dismiss(); assert.equal(h.player.active, true); assert.equal(h.ms.metadata.title, title);
  h.$('game-refresh').click(); assert.equal(h.prompt(), true); h.dismiss(); assert.equal(h.player.active, true); assert.equal(h.player.starts, 1);
  h.$('game').value = 'g1'; h.$('game').dispatchEvent(new h.w.Event('change')); h.proceed(); await flush();
  assert.equal(h.player.active, false); assert.equal(h.$('game').value, 'g1'); assert.equal(h.ms.metadata, null);
});

// ---------- Archive (src/archive.js) ----------
test('Archive publishes a score-free recording identity, keeps it through pause, end and error, and releases on stop or replacement', async t => {
  const item = { id: 'one', opponent: 'Tulane', sport: 'Football', start: '2026-09-05T18:00:00Z', kind: 'Game recording', url: 'https://gateway.example/media/archive/duke/one' };
  const dom = new JSDOM(html, { url: 'https://example.test/homecall/' });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => { requests.push(String(url)); return { ok: true, json: async () => ({ checkedAt: '2026-09-11T00:00:00Z', schools: { duke: { status: 'ready', source: 'https://duke.leanplayer.com/', items: [item] }, miami: { status: 'external', source: 'https://miamihurricanes.com/', items: [] }, vt: { status: 'ready', source: 'https://hokiesports.com/', items: [] } } }) }; });
  const oldDocument = globalThis.document, oldOption = globalThis.Option;
  globalThis.document = dom.window.document; globalThis.Option = dom.window.Option;
  t.after(() => { globalThis.document = oldDocument; globalThis.Option = oldOption; dom.window.close(); });
  const $ = id => document.getElementById(id), audio = $('replay-audio'), saved = [];
  audio.pause = () => {}; audio.load = () => {}; audio.play = async () => {};
  const ms = fakeMediaSession(), np = createNowPlaying({ mediaSession: ms, MediaMetadata: FakeMetadata, artwork: nowPlayingArtwork(dom.window.document.baseURI) });
  let stops = 0;
  setupArchive({ stopLive: () => { stops++; }, selectedTeam: () => 'duke', memory: { read: () => null, save: (...args) => saved.push(args) }, nowPlaying: np, origin: 'https://gateway.example' });
  await new Promise(r => setImmediate(r));
  $('archive-tab').click();
  assert.equal(ms.writes.length, 0, 'opening the tab and listing recordings never claim');
  $('archive-list').querySelector('button').click();
  assert.equal(stops, 1);
  const identity = { title: 'Duke vs Tulane', artist: 'Homecall · Archive recording', album: 'Duke', artwork: [{ src: ART, sizes: '512x512', type: 'image/png' }] };
  assert.deepEqual({ ...ms.metadata }, identity);
  const writes = ms.writes.length;
  for (const type of ['playing', 'pause', 'ended', 'error']) audio.dispatchEvent(new dom.window.Event(type));
  assert.deepEqual({ ...ms.metadata }, identity); assert.equal(ms.writes.length, writes, 'end and error keep the static identity for native replay');
  Object.defineProperty(audio, 'readyState', { value: 1 }); audio.currentTime = 7; audio.dispatchEvent(new dom.window.Event('timeupdate'));
  assert.deepEqual(saved.at(-1), ['replay', 'duke:one', 7], 'bookmarks are unchanged');
  $('archive-list').querySelector('button').click();
  assert.equal(ms.writes.length, writes, 'a pending replacement prompt changes nothing');
  $('confirm-continue').click();
  assert.deepEqual(ms.writes.slice(writes).map(x => x?.title ?? null), [null, 'Duke vs Tulane'], 'replacement releases before the new claim');
  assert.ok(requests.every(url => url.endsWith('/api/catalog/archive')), 'Archive never reads game status or scores');
  assert.ok(!/\d+, |ESPN|Q\d/.test(ms.metadata.title + ms.metadata.artist));
  $('archive-team').value = 'miami'; $('archive-team').onchange(); $('confirm-continue').click();
  assert.equal(ms.metadata, null);
  noControls(ms);
});
