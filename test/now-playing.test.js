import test from 'node:test';
import assert from 'node:assert/strict';
import { createNowPlaying, nowPlayingArtwork, nowPlayingText, periodText, formatReceipt, ARTWORK_PATH, TEAM_ARTWORK, schoolArtworkResolver, teamArtworkKey } from '../src/now-playing.js';
import { teams } from '../src/teams.js';
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
  for (const base of ['about:blank', 'blob:https://michaeltorbert.github.io/1234', 'data:text/html,x', 'file:///tmp/index.html', 'not a url', undefined]) {
    assert.equal(nowPlayingArtwork(base), null, String(base));
    assert.equal(nowPlayingArtwork(base, { mode: 'live', school: 'Duke' }, teams), null, `team art also needs a network base: ${base}`);
  }
});
const SITE = 'https://michaeltorbert.github.io/homecall/';
const artOf = (identity, base = SITE) => nowPlayingArtwork(base, identity, teams);
test('each supported school selects its own same-origin PNG at the root and under /homecall/', () => {
  assert.deepEqual(Object.keys(TEAM_ARTWORK).sort(), Object.keys(teams).sort(), 'one image per app team, no more');
  for (const [key, file] of Object.entries(TEAM_ARTWORK)) assert.equal(file, `now-playing/${key}-512.png`);
  for (const [key, team] of Object.entries(teams)) {
    for (const mode of ['live', 'game', 'sync', 'archive']) assert.equal(artOf({ mode, school: team.name }), `${SITE}now-playing/${key}-512.png`, `${mode} ${team.name}`);
    assert.equal(artOf({ mode: 'live', school: team.name }, 'http://127.0.0.1:4178/'), `http://127.0.0.1:4178/now-playing/${key}-512.png`);
    assert.equal(artOf({ mode: 'live', school: team.name }, 'http://127.0.0.1:4178/homecall/index.html?x=1'), `http://127.0.0.1:4178/homecall/now-playing/${key}-512.png`);
  }
});
test('the school resolver is exact: trimmed, case-insensitive, whole names only; everything else is generic', () => {
  const school = schoolArtworkResolver(teams);
  assert.equal(school('Duke'), 'duke'); assert.equal(school('  virginia tech '), 'vt'); assert.equal(school('GEORGIA TECH'), 'gt'); assert.equal(school('miami'), 'miami');
  for (const name of ['Virginia', 'Virginia Tech Hokies', 'Georgia', 'Tech', 'Miami (OH)', 'Miami (FL)', 'Miami OH', 'Miami-Ohio', 'Duke University', 'Blue Devils', 'Hokies', 'Dukes', 'Georgia  Tech',
    'Georgia-Tech', 'GT', 'VT', 'U', '', '   ', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'duke-512', 'gt', 'vt', 'miami.png', 'Duke\u0000'])
    assert.equal(school(name), null, JSON.stringify(name));
  for (const value of [undefined, null, 7, {}, ['Duke'], { toString: () => 'Duke' }]) assert.equal(school(value), null, String(value));
  // Only the app's own keys can be selected, even if a caller passes extra or hostile team entries.
  const hostile = schoolArtworkResolver({ ...teams, clemson: { name: 'Clemson' }, __proto__: { name: 'Proto' }, x: null });
  assert.equal(hostile('Clemson'), null); assert.equal(hostile('Proto'), null); assert.equal(hostile('Duke'), 'duke');
  assert.equal(schoolArtworkResolver()('Duke'), null); assert.equal(schoolArtworkResolver(null)('Duke'), null);
});
test('artwork follows only the frozen selected school and mode: opponents, titles, demo and teamless identities are generic', () => {
  const GENERIC = `${SITE}now-playing/homecall-512.png`;
  assert.equal(artOf({ mode: 'sync', school: 'Georgia Tech', opponent: 'Duke' }), `${SITE}now-playing/gt-512.png`, 'GT vs Duke shows GT');
  assert.equal(artOf({ mode: 'archive', school: 'Duke', opponent: 'Miami' }), `${SITE}now-playing/duke-512.png`, 'Duke vs Miami shows Duke');
  assert.equal(artOf({ mode: 'sync', school: 'Clemson', opponent: 'Duke' }), GENERIC, 'an unsupported school never borrows the opponent');
  assert.equal(artOf({ mode: 'live', title: 'Duke Sports Network', album: 'Duke' }), GENERIC, 'no school means generic, whatever the title or album say');
  for (const identity of [{ mode: 'demo', title: 'Timing demo · repeating tones' }, { mode: 'demo', school: 'Duke' }, { mode: 'other', school: 'Duke' }, { school: 'Duke' },
    { mode: 'live', school: 'Miami (OH)' }, { mode: 'live', school: 'Virginia' }, { mode: 'live', school: '__proto__' }, { mode: 'archive', school: 'toString' }, { mode: 'live', school: '' }])
    assert.equal(artOf(identity), GENERIC, JSON.stringify(identity));
  assert.equal(teamArtworkKey({ mode: 'demo', school: 'Duke' }, teams), null, 'demo is gated on mode, not on a missing school');
  assert.equal(nowPlayingArtwork(SITE, { mode: 'live', school: 'Duke' }), GENERIC, 'without the team map there is no team art');
  assert.equal(teamArtworkKey(null, teams), null); assert.equal(teamArtworkKey({ mode: 'live', get school() { throw Error('x'); } }, teams), null);
});
test('live text keeps source and receipt date/time in the same title as score and period; artist keeps the frozen matchup', () => {
  assert.deepEqual(nowPlayingText(GT_SYNC, snap(), { formatTime: at }),
    { title: 'Live · ESPN data received 10/7, 3:41 PM · Georgia Tech 17, Duke 14 · Q2 7:29', artist: 'Georgia Tech vs Duke · Homecall · Game broadcasts', album: 'Georgia Tech' });
  // The selected school comes first by provider ID, whatever the object or home/away order.
  assert.equal(nowPlayingText({ mode: 'sync', school: 'Duke', opponent: 'Georgia Tech' }, snap({}, { providerId: '150' }), { formatTime: at }).title,
    'Live · ESPN data received 10/7, 3:41 PM · Duke 14, Georgia Tech 17 · Q2 7:29');
  assert.equal(nowPlayingText({ mode: 'game', school: 'Georgia Tech', opponent: 'Duke', album: 'Georgia Tech · Homestream' }, snap(), { formatTime: at }).artist, 'Georgia Tech vs Duke · Homecall · Game broadcasts');
});
test('display labels are the app menu and tab names; old internal labels never appear', () => {
  const labels = Object.fromEntries(['live', 'game', 'sync', 'archive', 'demo'].map(mode => [mode, nowPlayingText({ mode, school: 'Duke', opponent: 'Tulane' }).artist]));
  assert.deepEqual(labels, { live: 'Homecall · Radio stations', game: 'Homecall · Game broadcasts', sync: 'Homecall · Game broadcasts', archive: 'Homecall · Recordings', demo: 'Homecall · Test tone' });
  for (const mode of ['live', 'game', 'sync', 'archive', 'demo']) for (const board of [null, snap()]) {
    const text = nowPlayingText({ mode, school: 'Duke', opponent: 'Tulane', title: mode === 'demo' ? 'Timing demo · repeating tones' : '' }, board, { formatTime: at });
    assert.ok(!/Live radio|Live game|Sync game|Archive recording|Homecall Timing demo|· Timing demo$/.test(text.artist), text.artist);
  }
  assert.equal(nowPlayingText({ mode: 'unknown', school: 'Duke' }).artist, 'Homecall · Audio');
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
  const plain = { title: 'Georgia Tech vs Duke', artist: 'Homecall · Game broadcasts', album: 'Georgia Tech' };
  assert.deepEqual(nowPlayingText(GT_SYNC, null), plain);
  assert.deepEqual(nowPlayingText(GT_SYNC, snap(), { formatTime: () => '' }), plain);
  assert.deepEqual(nowPlayingText(GT_SYNC, snap(), { formatTime: () => { throw Error('Intl'); } }), plain);
  assert.deepEqual(nowPlayingText(GT_SYNC, snap({}, { receivedAt: NaN }), { formatTime: at }), plain);
  for (const identity of [{ mode: 'live', school: 'Duke', title: 'Duke Sports Network' }, { mode: 'archive', school: 'Duke', opponent: 'Tulane' }, { mode: 'demo', title: 'Timing demo · repeating tones' }]) {
    const text = nowPlayingText(identity, snap(), { formatTime: at });
    assert.ok(!/\d+, |Q2|ESPN|Live ·/.test(text.title + text.artist), JSON.stringify(text));
  }
  assert.deepEqual(nowPlayingText({ mode: 'live', school: 'Duke', title: 'Duke Sports Network' }), { title: 'Duke Sports Network', artist: 'Homecall · Radio stations', album: 'Duke' });
  assert.deepEqual(nowPlayingText({ mode: 'archive', school: 'Duke', opponent: 'Tulane' }), { title: 'Duke vs Tulane', artist: 'Homecall · Recordings', album: 'Duke' });
  assert.deepEqual(nowPlayingText({ mode: 'demo', title: 'Timing demo · repeating tones' }), { title: 'Timing demo · repeating tones', artist: 'Homecall · Test tone', album: 'Homecall' });
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
  assert.deepEqual({ ...ms.metadata }, { title: 'Georgia Tech vs Duke', artist: 'Homecall · Game broadcasts', album: 'Georgia Tech', artwork: [{ src: ART, sizes: '512x512', type: 'image/png' }] });
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
  const throwingArt = fakeMediaSession(), np2 = createNowPlaying({ mediaSession: throwingArt, MediaMetadata: FakeMetadata, artwork: () => { throw Error('resolver'); } });
  assert.doesNotThrow(() => np2.claim(GT_SYNC));
  assert.deepEqual(throwingArt.metadata.artwork, [], 'a throwing resolver publishes text without artwork');
});
// Team artwork through the real resolver, as app.js wires it.
const teamArt = identity => nowPlayingArtwork(SITE, identity, teams);
const art = key => [{ src: `${SITE}now-playing/${key}-512.png`, sizes: '512x512', type: 'image/png' }];
test('publisher resolves artwork once per claim from the frozen identity; scores never change it', () => {
  const ms = fakeMediaSession(), calls = [];
  const np = createNowPlaying({ mediaSession: ms, MediaMetadata: FakeMetadata, artwork: identity => { calls.push(identity); return teamArt(identity); }, formatTime: at });
  const identity = { mode: 'sync', school: 'Georgia Tech', opponent: 'Duke' };
  const owner = np.claim(identity);
  identity.school = 'Duke'; identity.mode = 'demo';
  assert.deepEqual(ms.metadata.artwork, art('gt'));
  owner.update(snap()); owner.update(snap({ period: 3 })); owner.update(null);
  assert.equal(calls.length, 1, 'resolved once at claim');
  assert.ok(ms.writes.every(w => JSON.stringify(w.artwork) === JSON.stringify(art('gt'))), 'score updates and stripping keep the same image');
  assert.ok(ms.writes.every(w => !/\d+-\d+|score/i.test(w.artwork[0].src)), 'no score in the artwork address');
  calls[0].school = 'Duke';
  owner.update(snap());
  assert.deepEqual(ms.metadata.artwork, art('gt'), 'the resolver receives a copy; it cannot alter the frozen identity');
  for (const [claim, key] of [[{ mode: 'live', school: 'Duke', title: 'Duke Sports Network' }, 'duke'], [{ mode: 'archive', school: 'Virginia Tech', opponent: 'Miami' }, 'vt'],
    [{ mode: 'game', school: 'Georgia Tech', opponent: 'Duke', album: 'Georgia Tech · Homestream' }, 'gt'], [{ mode: 'live', school: 'Miami', title: '104.3 WQAM' }, 'miami'],
    [{ mode: 'demo', title: 'Timing demo · repeating tones' }, 'homecall'], [{ mode: 'sync', school: 'Miami (OH)', opponent: 'Duke' }, 'homecall']]) {
    np.claim(claim);
    assert.deepEqual(ms.metadata.artwork, art(key), JSON.stringify(claim));
  }
  noControls(ms);
});
test('a change of artwork alone republishes; identical text and artwork do not', () => {
  const ms = fakeMediaSession();
  const np = createNowPlaying({ mediaSession: ms, MediaMetadata: FakeMetadata, artwork: teamArt });
  // Same text, different school key: only the image differs between these two claims.
  const sameText = school => ({ mode: 'live', school, title: 'Shared Station', album: 'Shared' });
  np.claim(sameText('Duke'));
  np.claim(sameText('Georgia Tech'));
  assert.equal(ms.writes.length, 2, 'artwork-only change is published');
  assert.deepEqual([ms.writes[0].title, ms.writes[1].title], ['Shared Station', 'Shared Station']);
  assert.deepEqual(ms.metadata.artwork, art('gt'));
  np.claim(sameText('georgia tech '));
  assert.equal(ms.writes.length, 2, 'identical text and artwork are deduplicated');
  np.claim(sameText('Clemson'));
  assert.equal(ms.writes.length, 3); assert.deepEqual(ms.metadata.artwork, art('homecall'));
});
test('a rejected team payload is retried; release still clears; superseded owners stay inert', () => {
  const ms = fakeMediaSession({ failWrites: 1 });
  const np = createNowPlaying({ mediaSession: ms, MediaMetadata: FakeMetadata, artwork: teamArt, formatTime: at });
  const owner = np.claim({ mode: 'sync', school: 'Duke', opponent: 'Tulane' });
  assert.equal(ms.writes.length, 0, 'first write rejected');
  owner.update(null);
  assert.equal(ms.writes.length, 1, 'the identical payload is retried after a rejection');
  assert.deepEqual(ms.metadata.artwork, art('duke'));
  const next = np.claim({ mode: 'archive', school: 'Miami', opponent: 'Duke' });
  assert.deepEqual(ms.metadata.artwork, art('miami'));
  assert.equal(owner.update(snap()), false); assert.equal(owner.release(), false);
  assert.deepEqual(ms.metadata.artwork, art('miami'), 'a superseded owner cannot republish its team image');
  assert.equal(next.release(), true); assert.equal(ms.metadata, null);
  np.claim({ mode: 'sync', school: 'Duke', opponent: 'Tulane' });
  assert.deepEqual(ms.metadata.artwork, art('duke'), 'after a release the same payload is published again');
  noControls(ms);
});
