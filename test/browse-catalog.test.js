// Read-only browse lists (issue #68): current local week, truthful dates, bounded reads, cache and cancellation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowseCatalog, currentWeek, weekPlacement } from '../src/browse-catalog.js';
import { validateGames } from '../src/homestream.js';
globalThis.__GATEWAY_ORIGIN__ = 'https://gateway.example';
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
// Wednesday, October 21, 2026, local time.
const WED = local(2026, 10, 21, 12);

test('the week is the local Monday through Sunday containing now, by calendar date', () => {
  const week = currentWeek(WED);
  assert.equal(week.start, local(2026, 10, 19)); assert.equal(week.end, local(2026, 10, 26));
  assert.deepEqual([week.first, week.last], ['2026-10-19', '2026-10-25']);
  assert.equal(currentWeek(local(2026, 10, 25, 23, 59)).first, '2026-10-19', 'Sunday night is still this week');
  assert.equal(currentWeek(local(2026, 10, 26, 0, 0)).first, '2026-10-26', 'Monday starts the next week');
});
test('timed games inside the boundary count; a dated TBD counts by its catalog date; an undated game is never claimed', () => {
  const week = currentWeek(WED);
  assert.equal(weekPlacement({ start: local(2026, 10, 25, 23, 59) }, week), 'timed');
  assert.equal(weekPlacement({ start: local(2026, 10, 26, 0, 0) }, week), 'outside');
  assert.equal(weekPlacement({ start: local(2026, 10, 18, 23, 59) }, week), 'outside');
  assert.equal(weekPlacement({ start: null, date: '2026-10-24' }, week), 'tbd');
  assert.equal(weekPlacement({ start: null, date: '2026-10-26' }, week), 'outside');
  assert.equal(weekPlacement({ start: null }, week), 'undated');
  assert.equal(weekPlacement({ start: null, date: '2026-02-30' }, week), 'undated', 'an impossible date is not a date');
});
test('all catalog schools load with bounded concurrency, report partial failure and keep both schools of a shared game', async () => {
  let inFlight = 0, peak = 0; const reads = [];
  const lists = {
    A: [{ id: 'g1', opponent: 'B School', start: local(2026, 10, 24, 15, 30), url: null }, { id: 'g0', opponent: 'Old', start: local(2026, 9, 1), url: null }],
    B: [{ id: 'g1', opponent: 'A School', start: local(2026, 10, 24, 15, 30), url: 'https://gateway.example/media/game/B/g1' }, { id: 'tbd', opponent: 'Later', start: null, date: '2026-10-25', url: null }, { id: 'u', opponent: 'Someday', start: null, url: null }],
    D: [], E: [],
  };
  const read = async path => {
    reads.push(path); inFlight++; peak = Math.max(peak, inFlight);
    await new Promise(r => setTimeout(r, 5)); inFlight--;
    const id = path.split('/').at(-1);
    if (id === 'C') throw Error('catalog-unavailable');
    return lists[id];
  };
  const browse = createBrowseCatalog({ read, now: () => WED, concurrency: 2 });
  const schools = ['A', 'B', 'C', 'D', 'E'].map(id => ({ key: id.toLowerCase(), name: `${id} School`, catalogId: id })).concat({ key: 'vt', name: 'Virginia Tech', catalogId: null });
  const result = await browse.week(schools);
  assert.ok(peak <= 2, `peak ${peak}`); assert.equal(reads.length, 5, 'a school without a catalog identity is never read');
  assert.deepEqual(result.failed, ['C School']); assert.equal(result.schools, 5);
  assert.deepEqual(result.entries.map(e => `${e.key}:${e.game.id}:${e.placement}`), ['a:g1:timed', 'b:g1:timed', 'b:tbd:tbd']);
  assert.deepEqual(result.undated.map(e => e.game.id), ['u']);
  assert.equal(result.entries[1].game.url, 'https://gateway.example/media/game/B/g1');
  await browse.week(schools); assert.equal(reads.length, 6, 'cached lists are reused; only the failed school is read again');
  await browse.week(schools, { fresh: true }); assert.equal(reads.length, 11, 'an explicit refresh reads every school again');
});
test('cancellation rejects without results; invalid media routes reject that school only', async () => {
  const controller = new AbortController();
  const browse = createBrowseCatalog({ read: (_path, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted')))), now: () => WED });
  const pending = browse.week([{ key: 'a', name: 'A', catalogId: 'A' }], { signal: controller.signal });
  controller.abort(); await assert.rejects(pending);
  const bad = createBrowseCatalog({ read: async () => [{ id: 'g1', opponent: 'X', start: WED, url: 'https://elsewhere.example/feed.m3u8' }], now: () => WED });
  const result = await bad.week([{ key: 'a', name: 'A', catalogId: 'A' }]);
  assert.deepEqual(result.failed, ['A']); assert.equal(result.entries.length, 0);
  assert.throws(() => validateGames([{ id: 'g1', opponent: 'X', start: WED, url: 'https://gateway.example/media/game/OTHER/g1' }], 'A'), /catalog-invalid/, 'another school’s route is refused');
});
