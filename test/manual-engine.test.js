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
test('native source pause holds retained audio rather than silently draining the delay',()=>{
 const e=engine();feed(e,[1,2,3,4]);e.command('delay',.5);e.command('interrupt',true);
 assert.deepEqual(feed(e,[5,6,7,8]).samples,[0,0,0,0]);assert.equal(e.snapshot().delay,.5);assert.equal(e.snapshot().paused,true);
 e.command('ingest',true);e.command('pause',false);assert.deepEqual(feed(e,[9,10]).samples,[3,4]);
});
test('saved delay refills silently and resumes at the new incoming edge minus delay', () => {
 const e=engine(4);e.command('restore',1);
 assert.deepEqual(feed(e,[1,2]).samples,[0,0]);assert.equal(e.snapshot().restoring,1);
 assert.deepEqual(feed(e,[3,4]).samples,[0,0]);
 assert.deepEqual(feed(e,[5,6]).samples,[1,2]);assert.equal(e.snapshot().delay,1);
 assert.equal(e.snapshot().restoring,null);
});
test('source gap discards discontinuous history and restores the original delay, including repeated interruptions', () => {
 const e=engine(4);feed(e,[1,2,3,4,5,6,7,8]);e.command('delay',1);
 e.command('interrupt');feed(e,[0,0]);e.command('interrupt');e.command('ingest',true);
 assert.equal(e.snapshot().restoring,1);assert.equal(e.snapshot().available,0);
 feed(e,[9,10]);e.command('interrupt');e.command('ingest',true);
 assert.equal(e.snapshot().restoring,1);assert.equal(e.snapshot().available,0);
 feed(e,[11,12,13,14]);assert.deepEqual(feed(e,[15,16]).samples,[11,12]);
 assert.equal(e.snapshot().delay,1);
});
test('live skips restoration; pause recovery offers either saved delay or exact retained position', () => {
 const e=engine(4);e.command('restore',3);feed(e,[1,2]);e.command('live');
 assert.deepEqual(feed(e,[3,4]).samples,[3,4]);assert.equal(e.snapshot().restoring,null);
 e.command('delay',.5);e.command('pause',true);feed(e,[5,6,7,8]);
 e.command('restore',.5);assert.deepEqual(feed(e,[9,10]).samples,[7,8]);
 e.command('pause',true);feed(e,[11,12]);e.command('pause',false);
 assert.deepEqual(feed(e,[13,14]).samples,[9,10]);
});
test('maximum saved delay survives a render block crossing the capacity boundary', () => {
 const e=engine(4,2);e.command('restore',2);feed(e,[1,2,3,4,5,6]);
 assert.equal(feed(e,[7,8,9,10]).event,null);
 assert.deepEqual(feed(e,[11,12]).samples,[3,4]);assert.equal(e.snapshot().delay,2);
});

test('contiguous buffering recovery reuses available history instead of refilling',()=>{
 const e=engine(4);feed(e,[1,2,3,4,5,6,7,8]);e.command('delay',1);e.command('interrupt');feed(e,[0,0]);
 e.command('ingest',{playing:true,continuous:true});assert.equal(e.snapshot().available,2);
 assert.deepEqual(feed(e,[9,10]).samples,[7,8]);assert.equal(e.snapshot().delay,.5);assert.equal(e.snapshot().resumeDelay,1);
});

test('a deliberate pause during a stall survives both contiguous and discontinuous recovery',()=>{
 for(const recovery of [true,{playing:true,continuous:true}]){
  const e=engine(4);feed(e,new Array(40).fill(1));e.command('delay',2);e.command('interrupt');e.command('pause',true);
  e.command('ingest',recovery);feed(e,new Array(12).fill(2));feed(e,[3,4]);assert.equal(e.snapshot().paused,true);
  e.command('restore',2);feed(e,[5,6]);assert.equal(e.snapshot().paused,false);assert.equal(e.snapshot().delay,2);
 }
});
test('a delay adjustment during a stall replaces the pending recovery target',()=>{
 for(const action of ['delay','nudge']){
  const e=engine(4);feed(e,new Array(40).fill(1));e.command('delay',2);e.command('interrupt');
  const ack=e.command(action,action==='nudge'?1:3);e.command('ingest',{playing:true,continuous:true});feed(e,[2,3]);
  assert.equal(e.snapshot().delay,ack.after.delay);assert.equal(e.snapshot().delay,3);
 }
});

test('continuous stalls preserve sample order and reconnect preference across repeated gaps',()=>{
 const e=engine(4);feed(e,[1,2,3,4,5,6,7,8]);e.command('delay',1);
 e.command('interrupt');assert.deepEqual(feed(e,[0,0]).samples,[5,6]);e.command('ingest',{playing:true,continuous:true});
 assert.deepEqual(feed(e,[9,10]).samples,[7,8]);assert.equal(e.snapshot().resumeDelay,1);
 e.command('interrupt');assert.deepEqual(feed(e,[0]).samples,[9]);e.command('ingest',{playing:true,continuous:true});
 assert.deepEqual(feed(e,[11]).samples,[10]);assert.equal(e.snapshot().resumeDelay,1);
 e.command('nudge',.25);assert.equal(e.snapshot().resumeDelay,1.25);
});

test('discarded paused audio is never offered as the retained-position alternative',()=>{
 const e=engine(4);feed(e,new Array(40).fill(1));e.command('delay',2);e.command('interrupt');e.command('pause',true);
 e.command('ingest',true);feed(e,new Array(12).fill(2));feed(e,[3,4]);
 assert.equal(e.snapshot().paused,true);assert.equal(e.snapshot().canResumePosition,false);
 e.command('restore',2);feed(e,[5,6]);e.command('pause',true);assert.equal(e.snapshot().canResumePosition,true);
});
