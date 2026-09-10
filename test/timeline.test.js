import test from 'node:test';
import assert from 'node:assert/strict';
import { locateAudio, planSeek } from '../src/timeline.js';

test('clock-to-audio mapping respects period and interpolates elapsed time', () => {
  assert.deepEqual(locateAudio({ period: 2, clock: 119.5, running: true }, [
    { period: 1, clock: 120, running: true, audioTime: 60 },
    { period: 2, clock: 120, running: true, audioTime: 600 }
  ]), { state: 'matched', audioTime: 600.5 });
});
test('stopped clocks and repeated clock observations cannot create false sync', () => {
  const anchors = [10, 40].map(audioTime => ({ period: 1, clock: 120, running: true, audioTime }));
  assert.equal(locateAudio({ period: 1, clock: 120, running: false }, anchors).state, 'clock-stopped');
  assert.equal(locateAudio({ period: 1, clock: 120, running: true }, anchors).state, 'ambiguous');
});
test('never silently seeks across gaps or beyond available audio', () => {
  const ranges = [{ start: 10, end: 20 }, { start: 30, end: 40 }];
  assert.equal(planSeek(15, ranges).state, 'ready');
  assert.equal(planSeek(25, ranges).state, 'not-buffered');
  assert.equal(planSeek(5, ranges).state, 'not-buffered');
  assert.equal(planSeek(40, ranges).state, 'audio-behind-tv');
  assert.equal(planSeek(NaN, ranges).state, 'invalid');
});
