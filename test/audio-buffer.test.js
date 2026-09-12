import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioHistory } from '../src/audio-buffer.js';
function step(h, samples) { const out = [new Float32Array(samples.length), new Float32Array(samples.length)]; h.process([Float32Array.from(samples)], out); return [...out[0]]; }
test('live audio preserves sample order and duplicates mono to stereo', () => {
  const h = new AudioHistory(4, 3);
  assert.deepEqual(step(h, [1,2,3,4]), [1,2,3,4]);
  assert.equal(h.delay, 0);
});
test('pause accumulates history and resume plays the exact next sample', () => {
  const h = new AudioHistory(4, 3);
  step(h, [1,2,3,4]); h.paused = true;
  assert.deepEqual(step(h, [5,6,7,8]), [0,0,0,0]);
  assert.equal(h.delay, 1); h.paused = false;
  assert.deepEqual(step(h, [9,10,11,12]), [5,6,7,8]);
  assert.equal(h.delay, 1);
});
test('fractional delay seeks actual buffered samples and live resets it', () => {
  const h = new AudioHistory(4, 3); step(h, [1,2,3,4]); h.setDelay(.5);
  assert.deepEqual(step(h, [5,6]), [3,4]); h.setDelay(0);
  assert.deepEqual(step(h, [7,8]), [7,8]);
});
test('buffer overrun remains bounded and signals invalidated timing', () => {
  const h = new AudioHistory(2, 2); h.paused = true;
  step(h, [1,2,3,4,5,6]);
  assert.equal(h.delay, 2); assert.equal(h.overrun, true);
  h.paused = false;
  // The oldest retained sample is read before the full ring overwrites it.
  assert.deepEqual(step(h, [7,8]), [3,4]);
});
test('missing input drains history then emits silence without inventing samples', () => {
  const h = new AudioHistory(4,3); h.paused = true; step(h,[1,2]); h.paused=false;
  const out=[new Float32Array(4)]; h.process([],out);
  assert.deepEqual([...out[0]],[1,2,0,0]); assert.equal(h.written,2);
});
test('absolute sync seek uses retained sample positions and refuses clamping',()=>{
 const h=new AudioHistory(4,3);step(h,[1,2,3,4,5,6,7,8]);
 assert.equal(h.seekAudioTime(1).state,'applied');assert.equal(h.delay,1);
 assert.deepEqual(step(h,[9,10]),[5,6]);
 assert.equal(h.seekAudioTime(100).state,'audio-behind-tv');
 assert.equal(h.seekAudioTime(-1).state,'not-buffered');
});
