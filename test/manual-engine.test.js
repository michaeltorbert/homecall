import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualEngine } from '../src/manual-engine.js';
function feed(engine, values) {
  const out = [new Float32Array(values.length)];
  const event = engine.process([Float32Array.from(values)], out);
  return { samples: [...out[0]], event };
}
function engine(rate = 4, seconds = 180) { const e = new ManualEngine(rate, seconds); e.command('ingest', true); return e; }
test('rapid relative nudges accumulate and report actual clamping', () => {
  const e = engine(); feed(e, Array.from({ length: 40 }, (_, i) => i));
  for (let i = 0; i < 6; i++) e.command('nudge', .25);
  assert.equal(e.snapshot().delay, 1.5);
  const ack = e.command('nudge', -5);
  assert.equal(ack.before.delay, 1.5); assert.equal(ack.after.delay, 0);
  assert.equal(e.command('delay', 100).after.delay, 10);
});
test('hold keeps exact next audio until completion; cancel restores delay against current edge', () => {
  const e = engine(); feed(e, [1,2,3,4]); e.command('delay', .5);
  assert.equal(e.command('hold').after.holding, true);
  feed(e, [5,6,7,8]);
  assert.equal(e.command('nudge', 5).result, 'holding');
  assert.equal(e.command('pause', false).result, 'holding');
  const cancel = e.command('cancel'); assert.equal(cancel.after.delay, .5); assert.equal(cancel.after.paused, false);
  assert.deepEqual(feed(e, [9,10]).samples, [7,8]);
  e.command('hold'); feed(e, [11,12]); e.command('complete');
  assert.deepEqual(feed(e, [13,14]).samples, [9,10]);
});
test('holding requires playing source; discontinuity aborts hold paused and never resumes itself', () => {
  const e = engine(); e.command('pause', true); assert.equal(e.command('hold').result, 'unavailable');
  e.command('pause', false); e.command('hold'); e.command('interrupt');
  assert.equal(e.snapshot().holding, false); assert.equal(e.snapshot().paused, true);
  e.command('ingest', true); assert.equal(e.snapshot().paused, true);
});
test('gated missing media does not invent samples but real silence remains valid audio', () => {
  const e = engine(); feed(e, [0,0,0,0]); assert.equal(e.snapshot().receivedSeconds, 1);
  e.command('interrupt'); feed(e, [0,0,0,0]); assert.equal(e.snapshot().receivedSeconds, 1);
  e.command('ingest', true); feed(e, [0,0,0,0]); assert.equal(e.snapshot().receivedSeconds, 2);
});
test('overrun emits once, cancels hold and stays paused; forced advance is not rendered playback', () => {
  const e = engine(2,2); feed(e, [1,2]); e.command('hold');
  assert.equal(feed(e,[3,4,5,6,7,8]).event, 'buffer-overrun');
  assert.equal(e.snapshot().holding, false); assert.equal(e.snapshot().paused, true);
  assert.equal(e.snapshot().renderedSeconds, 1);
  assert.equal(feed(e,[9,10]).event, null);
  assert.equal(e.snapshot().delay, 2);
});
test('pause survives seeks, while new engine begins with empty epoch', () => {
  const e = engine(); feed(e,[1,2,3,4]); e.command('pause', true);
  e.command('nudge', .5); e.command('live'); assert.equal(e.snapshot().paused, true);
  const fresh = engine(); assert.equal(fresh.snapshot().available, 0); assert.equal(fresh.snapshot().receivedSeconds, 0);
});
test('context invalidation aborts a hold without permanently stopping live ingestion', () => {
  const e = engine(); feed(e,[1,2]); e.command('hold'); e.command('invalidate');
  assert.equal(e.snapshot().ingesting, true); assert.equal(e.snapshot().holding, false); assert.equal(e.snapshot().paused, true);
});
