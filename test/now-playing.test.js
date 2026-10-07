import test from 'node:test';
import assert from 'node:assert/strict';
import { createNowPlaying, nowPlayingArtwork, nowPlayingText, periodText, formatReceipt, ARTWORK_PATH } from '../src/now-playing.js';
// Fake platform object: records metadata writes and any control API use (which must stay zero).
function fakeMediaSession({ failWrites = 0 } = {}) {
  const ms = { writes: [], actions: [], positions: [], states: [], current: null };
  Object.defineProperty(ms, 'metadata', { get: () => ms.current, set: value => { if (failWrites > 0) { failWrites--; throw Error('rejected'); } ms.writes.push(value); ms.current = value; } });
  Object.defineProperty(ms, 'playbackState', { get: () => 'none', set: value => { ms.states.push(value); } });
  ms.setActionHandler = (...args) => { ms.actions.push(args); };
  ms.setPositionState = (...args) => { ms.positions.push(args); };
  return ms;
}
class FakeMetadata { constructor(init) { Object.assign(this, structuredClone(init)); } }
const ART = 'https://michaeltorbert.github.io/homecall/now-playing/homecall-512.png';
const at = () => '10/7, 3:41 PM';
const GT_SYNC = { mode: 'sync', school: 'Georgia Tech', opponent: 'Duke' };
const snap = (board = {}, extra = {}) => ({ eventId: '401858255', providerId: '59', receivedAt: 1, board: { phase: 'in-progress', period: 2, clock: '7:29', scores: { 150: 14, 59: 17 }, ...board }, ...extra });
const noControls = ms => { assert.deepEqual([ms.actions, ms.positions, ms.states], [[], [], []], 'no action handlers, position state or playback state'); };

test('one original PNG artwork resolves same-origin under the deployed base path; non-network bases have none', () => {
  assert.equal(ARTWORK_PATH.endsWith('.png'), true);
  assert.equal(nowPlayingArtwork('https://michaeltorbert.github.io/homecall/'), ART);
  assert.equal(nowPlayingArtwork('https://michaeltorbert.github.io/homecall/index.html?team=duke#x'), ART);
  assert.equal(nowPlayingArtwork('http://127.0.0.1:4178/'), 'http://127.0.0.1:4178/now-playing/homecall-512.png');
  for (const base of ['about:blank', 'blob:https://michaeltorbert.github.io/1234', 'data:text/html,x', 'file:///tmp/index.html', 'not a url', undefined]) assert.equal(nowPlayingArtwork(base), null, String(base));
});
test('live text keeps source and receipt date/time in the same title as score and period; artist keeps the frozen matchup', () => {
  assert.deepEqual(nowPlayingText(GT_SYNC, snap(), { formatTime: at }),
    { title: 'Live · ESPN data received 10/7, 3:41 PM · Georgia Tech 17, Duke 14 · Q2 7:29', artist: 'Georgia Tech vs Duke · Homecall Sync game', album: 'Georgia Tech' });
  // The selected school comes first by provider ID, whatever the object or home/away order.
  assert.equal(nowPlayingText({ mode: 'sync', school: 'Duke', opponent: 'Georgia Tech' }, snap({}, { providerId: '150' }), { formatTime: at }).title,
    'Live · ESPN data received 10/7, 3:41 PM · Duke 14, Georgia Tech 17 · Q2 7:29');
  assert.equal(nowPlayingText({ mode: 'game', school: 'Georgia Tech', opponent: 'Duke', album: 'Georgia Tech · Homestream' }, snap(), { formatTime: at }).artist, 'Georgia Tech vs Duke · Homecall Live game');
});
test('partial, regulation-zero, halftime, overtime and score-free snapshots', () => {
  const title = board => nowPlayingText(GT_SYNC, snap(board), { formatTime: at }).title;
  assert.equal(title({ clock: undefined }), 'Live · ESPN data received 10/7, 3:41 PM · Georgia Tech 17, Duke 14 · Q2');
  assert.equal(title({ period: undefined, clock: undefined }), 'Live · ESPN data received 10/7, 3:41 PM · Georgia Tech 17, Duke 14 · In progress');
  assert.equal(title({ scores: undefined }), 'Live · ESPN data received 10/7, 3:41 PM · Q2 7:29');
  assert.equal(title({ period: 4, clock: '0:00', scores: { 59: 0, 150: 0 } }), 'Live · ESPN data received 10/7, 3:41 PM · Georgia Tech 0, Duke 0 · Q4 0:00');
  assert.equal(title({ phase: 'halftime', clock: undefined }), 'Live · ESPN data received 10/7, 3:41 PM · Georgia Tech 17, Duke 14 · Halftime');
  assert.equal(title({ period: 5, clock: undefined }), 'Live · ESPN data received 10/7, 3:41 PM · Georgia Tech 17, Duke 14 · OT1');
  assert.equal(periodText({ phase: 'in-progress', period: 6 }), 'OT2');
  assert.equal(title({ scores: { 59: 17, 2: 3 } }).includes('17, Duke'), true, 'scores are read by provider ID');
  assert.equal(title({ scores: { 150: 14, 2: 3 } }), 'Live · ESPN data received 10/7, 3:41 PM · Q2 7:29', 'a score map without the selected school is not displayed');
});
test('no receipt time or a non-game identity never shows volatile data', () => {
  const plain = { title: 'Georgia Tech vs Duke', artist: 'Homecall · Sync game', album: 'Georgia Tech' };
  assert.deepEqual(nowPlayingText(GT_SYNC, null), plain);
  assert.deepEqual(nowPlayingText(GT_SYNC, snap(), { formatTime: () => '' }), plain);
  assert.deepEqual(nowPlayingText(GT_SYNC, snap(), { formatTime: () => { throw Error('Intl'); } }), plain);
  assert.deepEqual(nowPlayingText(GT_SYNC, snap({}, { receivedAt: NaN }), { formatTime: at }), plain);
  for (const identity of [{ mode: 'live', school: 'Duke', title: 'Duke Sports Network' }, { mode: 'archive', school: 'Duke', opponent: 'Tulane' }, { mode: 'demo', title: 'Timing demo · repeating tones' }]) {
    const text = nowPlayingText(identity, snap(), { formatTime: at });
    assert.ok(!/\d+, |Q2|ESPN|Live ·/.test(text.title + text.artist), JSON.stringify(text));
  }
  assert.deepEqual(nowPlayingText({ mode: 'live', school: 'Duke', title: 'Duke Sports Network' }), { title: 'Duke Sports Network', artist: 'Homecall · Live radio', album: 'Duke' });
  assert.deepEqual(nowPlayingText({ mode: 'archive', school: 'Duke', opponent: 'Tulane' }), { title: 'Duke vs Tulane', artist: 'Homecall · Archive recording', album: 'Duke' });
  assert.deepEqual(nowPlayingText({ mode: 'demo', title: 'Timing demo · repeating tones' }), { title: 'Timing demo · repeating tones', artist: 'Homecall · Timing demo', album: 'Homecall' });
});
test('long or unusual names stay bounded without dropping source or receipt date', () => {
  const long = 'University of an Extremely Long Football Program Name\u0000\nwith control text';
  const text = nowPlayingText({ mode: 'sync', school: long, opponent: long }, snap(), { formatTime: at });
  assert.match(text.title, /^Live · ESPN data received 10\/7, 3:41 PM · /);
  assert.ok(!/[\u0000-\u001f]/.test(text.title + text.artist));
  for (const name of text.artist.split(' · ')[0].split(' vs ')) assert.ok(name.length <= 32 && name.endsWith('…'), name);
  assert.ok(text.title.length < 140, String(text.title.length));
});
test('the default receipt format carries a date and a time', () => {
  // Locale and time zone vary by machine; require a month/day pair and an hour:minute time.
  const value = formatReceipt(Date.UTC(2026, 9, 7, 19, 41));
  assert.ok(value.match(/\d+/g).length >= 4, value); assert.match(value, /\d{1,2}:\d{2}/);
  assert.match(nowPlayingText(GT_SYNC, snap({}, { receivedAt: Date.UTC(2026, 9, 7, 19, 41) })).title, /^Live · ESPN data received .+\d{1,2}:\d{2}.* · Georgia Tech 17, Duke 14 · Q2 7:29$/);
});
test('publisher writes identity with the PNG artwork, dedupes unchanged payloads and never touches controls', () => {
  const ms = fakeMediaSession(), np = createNowPlaying({ mediaSession: ms, MediaMetadata: FakeMetadata, artwork: ART, formatTime: at });
  assert.equal(np.supported, true);
  const owner = np.claim(GT_SYNC);
  assert.deepEqual({ ...ms.metadata }, { title: 'Georgia Tech vs Duke', artist: 'Homecall · Sync game', album: 'Georgia Tech', artwork: [{ src: ART, sizes: '512x512', type: 'image/png' }] });
  owner.update(null); owner.update(null);
  assert.equal(ms.writes.length, 1, 'unchanged payloads are not rewritten');
  owner.update(snap()); owner.update(snap());
  assert.equal(ms.writes.length, 2); assert.match(ms.metadata.title, /Q2 7:29$/);
  owner.update(null);
  assert.equal(ms.metadata.title, 'Georgia Tech vs Duke', 'stripping keeps the static identity');
  assert.deepEqual(ms.metadata.artwork, [{ src: ART, sizes: '512x512', type: 'image/png' }]);
  assert.equal(owner.release(), true); assert.equal(ms.metadata, null);
  assert.equal(owner.release(), false); assert.equal(owner.update(snap()), false);
  assert.equal(ms.writes.length, 4); noControls(ms);
});
test('a superseded owner can never update or clear its successor, even with an identical identity', () => {
  const ms = fakeMediaSession(), np = createNowPlaying({ mediaSession: ms, MediaMetadata: FakeMetadata, artwork: ART, formatTime: at });
  const first = np.claim(GT_SYNC), second = np.claim(GT_SYNC);
  assert.equal(first.current, false); assert.equal(second.current, true);
  assert.equal(first.update(snap()), false); assert.equal(first.release(), false);
  assert.equal(ms.metadata.title, 'Georgia Tech vs Duke');
  second.update(snap());
  const live = np.claim({ mode: 'live', school: 'Duke', title: 'Duke Sports Network' });
  assert.equal(second.update(snap({ period: 3 })), false);
  assert.equal(ms.metadata.title, 'Duke Sports Network');
  assert.equal(live.update(snap()), true); assert.equal(ms.metadata.title, 'Duke Sports Network', 'radio identity ignores scoreboards');
  assert.equal(second.release(), false); assert.equal(ms.metadata.title, 'Duke Sports Network');
  noControls(ms);
});
test('unsupported platforms and throwing setters or constructors never break playback callers', () => {
  for (const options of [{}, { mediaSession: fakeMediaSession() }, { MediaMetadata: FakeMetadata }]) {
    const np = createNowPlaying(options);
    assert.equal(np.supported, false);
    const owner = np.claim(GT_SYNC);
    assert.doesNotThrow(() => { owner.update(snap()); owner.release(); });
    if (options.mediaSession) assert.equal(options.mediaSession.writes.length, 0);
  }
  const ms = fakeMediaSession({ failWrites: 1 }), np = createNowPlaying({ mediaSession: ms, MediaMetadata: FakeMetadata, artwork: ART, formatTime: at });
  const owner = np.claim(GT_SYNC);
  assert.equal(ms.writes.length, 0);
  owner.update(null);
  assert.equal(ms.writes.length, 1, 'a rejected payload is retried rather than deduped');
  const broken = createNowPlaying({ mediaSession: fakeMediaSession(), MediaMetadata: class { constructor() { throw TypeError('bad artwork'); } } });
  assert.doesNotThrow(() => { const o = broken.claim(GT_SYNC); o.update(snap()); o.release(); });
});
