// Pure resolver and listening-intent fixtures (no audio, DOM or network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { teams, catalogTeams, liveSourceIds, gameSourceId } from '../src/teams.js';
import { SUPPORTED_TEAMS } from '../lib/supported-teams.mjs';
import { listenTeams, resolveSources, officialLink } from '../src/listen-sources.js';
import { createListenSession, failureKind } from '../src/listen-session.js';
import { ContinuityMap } from '../src/hls-timeline.js';
import { SessionLog } from '../src/session-log.js';
globalThis.__GATEWAY_ORIGIN__ = 'https://gateway.example';
const CATALOG = [{ id: 'ffacbef1-e8a5-4872-9401-eff97cdf2c9c', name: 'Auburn' }, { id: '2903e5f6-960e-4954-a3ec-f7754e78660f', name: 'Duke' },
  { id: '410422f0-663f-4e3d-82e2-787d954ae29d', name: 'Georgia Tech' }, { id: 'b3c33c46-a9e4-4e3b-9d5a-4fefb625f14c', name: 'Virginia' }];
const game = { id: 'g1', opponent: 'Tulane', url: 'https://gateway.example/media/game/2903e5f6-960e-4954-a3ec-f7754e78660f/g1' };
const ids = r => r.candidates.map(c => c.sourceId);

test('catalog identities are explicit and match the supported-team snapshot; Virginia Tech has none', () => {
  const byName = Object.fromEntries(SUPPORTED_TEAMS.map(t => [t.name, t.homestreamId]));
  assert.equal(teams.duke.catalogId, byName.Duke); assert.equal(teams.gt.catalogId, byName['Georgia Tech']);
  assert.equal(catalogTeams.uva.catalogId, byName.Virginia); assert.equal(catalogTeams.auburn.catalogId, byName.Auburn);
  assert.equal(teams.vt.catalogId, undefined); assert.equal(teams.miami.catalogId, undefined);
  assert.equal(gameSourceId('gt'), 'gt-homestream', 'Georgia Tech keeps its source ID and saved delays');
  for (const id of ['duke-game', 'uva-game', 'auburn-game', 'catalog-game', 'gt-homestream', 'duke-wtib']) assert.ok(liveSourceIds.includes(id), id);
});
test('every catalog school is reachable by explicit ID; names never merge schools and Virginia Tech never becomes Virginia', () => {
  const list = listenTeams([...CATALOG, { id: '00000000-0000-4000-8000-000000000001', name: 'Elsewhere State' }, { id: 'not-a-uuid', name: 'Bad' }, { id: '00000000-0000-4000-8000-000000000002', name: 'Virginia Tech' }]);
  assert.deepEqual([...list.keys()], ['gt', 'duke', 'miami', 'vt', 'auburn', 'uva', 'catalog:00000000-0000-4000-8000-000000000001', 'catalog:00000000-0000-4000-8000-000000000002']);
  assert.equal(list.get('vt').catalogId, null, 'a catalog entry named Virginia Tech is a separate catalog-only school');
  assert.equal(list.get('uva').name, 'Virginia'); assert.equal(list.get('uva').radio, false);
  assert.equal(list.get('catalog:00000000-0000-4000-8000-000000000001').name, 'Elsewhere State');
  assert.deepEqual([...listenTeams().keys()], ['gt', 'duke', 'miami', 'vt'], 'without the catalog only configured teams are listed');
});
test('order: playable game feed, network, network backup, affiliates; checking and unavailable states are honest', () => {
  const duke = listenTeams(CATALOG).get('duke');
  assert.deepEqual(ids(resolveSources(duke, { status: 'ready', game })), ['duke-game', 'duke-leanstream', 'duke-varsity', 'duke-wsjs', 'duke-wccg', 'duke-wtib']);
  assert.deepEqual(resolveSources(duke, { status: 'ready', game }).candidates.map(c => c.kind), ['game', 'network', 'network-backup', 'affiliate', 'affiliate', 'affiliate']);
  for (const status of ['idle', 'loading', 'checking']) assert.equal(resolveSources(duke, { status, game: null }).state, 'checking', status);
  const unavailable = resolveSources(duke, { status: 'unavailable', game: null });
  assert.equal(unavailable.state, 'resolved'); assert.equal(unavailable.game, 'unavailable'); assert.deepEqual(ids(unavailable).slice(0, 1), ['duke-leanstream']);
  assert.equal(resolveSources(duke, { status: 'ready', game: { ...game, url: null } }).game, 'unavailable', 'an unpublished feed is not playable');
  const uva = listenTeams(CATALOG).get('uva');
  assert.deepEqual(resolveSources(uva, { status: 'unavailable' }), { state: 'unavailable', game: 'unavailable', gameSourceId: 'uva-game', candidates: [] });
  assert.deepEqual(ids(resolveSources(uva, { status: 'ready', game })), ['uva-game'], 'no network is invented for a catalog-only school');
  assert.deepEqual(ids(resolveSources(listenTeams(CATALOG).get('gt'), { status: 'ready', game })), ['gt-homestream']);
  assert.deepEqual(ids(resolveSources(listenTeams(CATALOG).get('vt'), { status: 'ready', game })), ['vt-leanstream'], 'Virginia Tech ignores catalog readiness');
});
test('duplicates keep their first rank by ID and address; official links come only from configuration', () => {
  const duke = listenTeams(CATALOG).get('duke');
  const shared = resolveSources(duke, { status: 'ready', game: { ...game, url: teams.duke.url } });
  assert.deepEqual(ids(shared).slice(0, 2), ['duke-game', 'duke-varsity'], 'the network with the same address as the game feed is removed');
  assert.equal(officialLink(duke, shared.candidates[0]), 'https://duke.leanplayer.com/');
  assert.equal(officialLink(listenTeams(CATALOG).get('uva'), null), null); assert.equal(officialLink(listenTeams(CATALOG).get('gt'), null), 'https://ramblinwreck.com/radio');
});
const list = ['game', 'net', 'backup', 'wsjs'].map(sourceId => ({ sourceId }));
test('candidate entry is once per intent and separate from physical attempts; exhaustion ends the intent', () => {
  const s = createListenSession(); s.begin(list);
  const first = s.attempt(), retry = s.attempt();
  assert.notEqual(first.attemptId, retry.attemptId); assert.deepEqual(s.intent.trace, ['game'], 'same-source attempts are not new candidates');
  assert.equal(s.current(first), false); assert.equal(s.current(retry), true);
  for (const expected of ['net', 'backup', 'wsjs']) { assert.equal(s.advance().sourceId, expected); s.attempt(); }
  assert.deepEqual(s.intent.trace, ['game', 'net', 'backup', 'wsjs']);
  assert.equal(s.advance(), null); assert.equal(s.intent, null, 'exhaustion ends the intent');
  s.begin(list); assert.deepEqual(s.intent.trace, [], 'Retry is a new intent');
});
test('a manual mode starts at its choice and falls back only downward; mode lifetime is explicit', () => {
  const s = createListenSession(); s.setMode('backup'); s.begin(list); assert.equal(s.attempt().candidate.sourceId, 'backup');
  assert.equal(s.advance().sourceId, 'wsjs'); s.attempt(); assert.equal(s.advance(), null);
  assert.equal(s.mode, 'backup', 'Play, Stop and exhaustion never change the mode');
  s.setMode('missing'); assert.equal(s.begin(list), null, 'an unavailable manual choice starts nothing');
  s.setMode(); assert.equal(s.mode, 'auto');
});
test('denial, pause and stale tokens: a held candidate resumes in place; notices only for replacements and only once', () => {
  const s = createListenSession(); s.begin(list);
  let token = s.attempt(); assert.equal(s.outputReady(token), false, 'the first candidate is not a switch');
  s.advance(); token = s.attempt(); s.hold('denied');
  assert.equal(s.pending, 'denied'); assert.equal(s.current(token), false, 'stale callbacks of the denied attempt are inert'); assert.equal(s.outputReady(token), false);
  token = s.attempt(); assert.equal(s.candidate.sourceId, 'net'); assert.equal(s.pending, null);
  assert.equal(s.outputReady(token), true); assert.equal(s.outputReady(token), false, 'same-source recovery shows no second notice');
  s.cancel(); assert.equal(s.current(token), false); assert.equal(s.outputReady(token), false);
});
test('failure classes: permission and local keep the source; transport and availability may advance', () => {
  const denied = Object.assign(Error('x'), { name: 'NotAllowedError' });
  assert.deepEqual([denied, Error('unsupported'), Error('hls-unsupported'), Error('anything'), Object.assign(Error('t'), { kind: 'local' })].map(failureKind), ['permission', 'environment', 'availability', 'transport', 'local']);
});
test('continuity intervals map only verified contiguous ingestion and never across a gap', () => {
  const map = new ContinuityMap();
  for (const r of [0, 0.25, 0.5]) map.sample(r, 40 + r);
  assert.equal(map.position(0.4), 40.4); assert.ok(Number.isNaN(map.position(0.6)), 'beyond the newest verified input');
  map.sample(0.75, 40.75 + 0.3); assert.ok(Number.isNaN(map.position(0.75)), 'an offset jump opens a new unverified interval');
  assert.equal(map.position(0.4), 40.4, 'older samples keep their own interval');
  map.close(); map.sample(1, 41.05); map.sample(1.5, 41.55); map.sample(2, 42.05); assert.ok(Math.abs(map.position(1.8) - 41.85) < 1e-9);
  map.clear(); assert.ok(Number.isNaN(map.position(1.8)));
});
test('session logs allowlist the trigger, previous source and configured catalog teams only', () => {
  const log = new SessionLog({ storage: null, id: () => 'one', utc: () => '2026-10-10T00:00:00.000Z', now: () => 0 });
  log.start('uva', 'uva-game', 'live', 'unspecified', 'unspecified', { trigger: 'fallback', previousSourceId: 'duke-game' });
  assert.deepEqual([log.session.team, log.session.sourceId, log.session.trigger, log.session.previousSourceId], ['uva', 'uva-game', 'fallback', 'duke-game']);
  log.start('catalog:00000000-0000-4000-8000-000000000001', 'catalog-game', 'live', 'unspecified', 'unspecified', { trigger: 'https://x', previousSourceId: 'https://private' });
  assert.equal(log.session.team, 'catalog'); assert.equal(log.session.trigger, undefined); assert.equal(log.session.previousSourceId, undefined);
  log.start('duke', 'duke-leanstream'); assert.equal(log.session.trigger, undefined, 'the two-argument form is unchanged');
});
