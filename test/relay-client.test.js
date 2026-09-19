import test from 'node:test';
import assert from 'node:assert/strict';
import { relayURL, mediaURL } from '../src/gateway.js';
import { validateCatalog } from '../src/replay.js';
const origin = 'https://gateway.example';
const item = { id: 'saved-id', opponent: 'Opponent', sport: 'Football', start: '2026-09-12T12:00:00Z', kind: 'Game', url: origin + '/media/archive/duke/saved-id' };
const catalog = () => ({ checkedAt: '2026-09-18T12:00:00Z', schools: Object.fromEntries(['duke','vt','miami'].map(school => [school, { status: school === 'duke' ? 'stale' : 'external', source: 'https://official.example/', checkedAt: '2026-09-12T12:00:00Z', items: school === 'duke' ? [{ ...item }] : [] }])) });
test('archive keeps stable bookmarks, source attribution and stale check time', () => {
  const data = validateCatalog(catalog(), { origin });
  assert.equal(data.schools.duke.items[0].id, 'saved-id');
  assert.equal(data.schools.duke.source, 'https://official.example/');
  assert.equal(data.schools.duke.status, 'stale');
  assert.equal(data.schools.duke.checkedAt, '2026-09-12T12:00:00Z');
});
test('archive rejects cross-origin, wrong school, wrong ID and malformed recording routes', () => {
  for (const url of ['https://upstream.example/a.mp3', origin+'/media/archive/vt/saved-id', origin+'/media/archive/duke/other', item.url+'?target=x', item.url+'#x']) {
    const data = catalog(); data.schools.duke.items[0].url = url;
    assert.throws(() => validateCatalog(data, { origin }));
  }
});
test('media routes require configured origin and loopback requires explicit opt-in', () => {
  assert.throws(() => relayURL('/media/live/duke', ''));
  assert.throws(() => relayURL('/media/live/duke', 'http://localhost:4178'));
  assert.equal(relayURL('/media/live/duke','http://localhost:4178',{allowLocal:true}), 'http://localhost:4178/media/live/duke');
  assert.equal(mediaURL(origin+'/media/live/duke', {origin}),origin+'/media/live/duke');
  assert.throws(() => relayURL('/media/live/../private',origin));
});
