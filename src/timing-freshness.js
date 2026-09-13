export const TIMING_BUDGET_MS = 45000;
// Compare elapsed local clocks, never the browser wall clock to checkedAt.
export function createTimingFreshness({ clock = () => ({ wall: Date.now(), mono: performance.now() }) } = {}) {
  let sample = null, status = 'waiting';
  const duration = (start, end) => {
    if (![start?.wall, start?.mono, end?.wall, end?.mono].every(Number.isFinite)) return NaN;
    const wall = end.wall - start.wall, mono = end.mono - start.mono;
    return wall < 0 || mono < 0 || Math.abs(wall - mono) > 1000 ? NaN : Math.max(wall, mono);
  };
  return {
    start: clock,
    invalidate() { sample = null; status = 'waiting'; },
    status() { this.fresh(); return status; },
    receive(data, started) {
      const received = clock(), elapsed = duration(started, received);
      status = data?.ageMs === null ? 'unknown' : 'stale';
      sample = Number.isSafeInteger(data?.checkedAt) && data.checkedAt > 0 && Number.isSafeInteger(data?.ageMs) && data.ageMs >= 0 && Number.isFinite(elapsed)
        ? { received, last: received, age: data.ageMs + elapsed } : null;
      if (sample) status = 'fresh';
    },
    fresh() {
      if (!sample) return false;
      const current = clock(), elapsed = duration(sample.received, current), step = duration(sample.last, current);
      if (!Number.isFinite(elapsed) || !Number.isFinite(step) || sample.age + elapsed >= TIMING_BUDGET_MS) { sample = null; status = 'stale'; return false; }
      sample.last = current;
      return true;
    }
  };
}
export function nextPollDelay(previous, success) { return success ? 15000 : Math.min(120000, previous * 2); }
