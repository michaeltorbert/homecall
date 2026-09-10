/** Match observed game clocks to independently timestamped radio positions.
 * Anchors must come from the AUDIO timeline, not arrival times of score updates.
 * Times are seconds. Invalid or ambiguous observations never imply a match.
 */
export function locateAudio(observation, anchors, { maxError = 0.6 } = {}) {
  const valid = x => x && Number.isInteger(x.period) && x.period > 0 &&
    Number.isFinite(x.clock) && x.clock >= 0;
  if (!valid(observation) || !Number.isFinite(maxError) || maxError < 0)
    return { state: 'invalid' };
  if (!observation.running) return { state: 'clock-stopped' };
  const candidates = anchors.filter(a => valid(a) && a.running &&
    Number.isFinite(a.audioTime) && a.audioTime >= 0 &&
    a.period === observation.period &&
    Math.abs(a.clock - observation.clock) <= maxError &&
    (observation.eventId == null || observation.eventId === a.eventId));
  if (!candidates.length) return { state: 'no-match' };
  // Different audio positions for the same game clock are not safe to guess.
  const positions = candidates.map(a => a.audioTime + a.clock - observation.clock);
  if (Math.max(...positions) - Math.min(...positions) > maxError)
    return { state: 'ambiguous' };
  return { state: 'matched', audioTime: positions.reduce((a, b) => a + b, 0) / positions.length };
}

export function planSeek(target, ranges) {
  if (!Number.isFinite(target) || target < 0) return { state: 'invalid' };
  const usable = ranges.filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.start >= 0 && r.end > r.start);
  if (!usable.length) return { state: 'not-buffered' };
  if (usable.some(r => target >= r.start && target < r.end))
    return { state: 'ready', target };
  if (target >= Math.max(...usable.map(r => r.end))) return { state: 'audio-behind-tv' };
  return { state: 'not-buffered' };
}
