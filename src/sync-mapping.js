export function clockSeconds(value) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(String(value).trim());
  const seconds = match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  return seconds <= 900 ? seconds : NaN;
}
// Verified catalog/provider spelling difference; do not use fuzzy school matching.
export const schoolKey = value => {
  const key = String(value).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return key === 'southernmississippi' ? 'southernmiss' : key;
};
export function matchEvent(events, school, game) {
  if (!Number.isFinite(game.start)) return null;
  const wanted = [schoolKey(school), schoolKey(game.opponent)].sort().join('|');
  const matches = events.filter(e => e.teams.map(schoolKey).sort().join('|') === wanted && Math.abs(e.start - game.start) < 24 * 60 * 60 * 1000);
  return matches.length === 1 ? matches[0] : null;
}
export const playLabel = p => `${p.quarter > 4 ? 'OT' + (p.quarter - 4) : 'Q' + p.quarter} ${p.clock}`;
export const gameOrder = (a,b) => a.quarter-b.quarter || clockSeconds(b.clock)-clockSeconds(a.clock);
export function availableAnchors(plays, timing, offset = 0) {
  if (!timing || !Number.isFinite(timing.utc) || !Number.isFinite(offset)) return [];
  return plays.flatMap(p => {
    const utc = p.utc + offset * 1000;
    const spans = (timing.spans || []).filter(span => utc >= span.utc && utc < span.utc + span.duration * 1000);
    // Overlapping timestamps across discontinuities are ambiguous, never guessed.
    if (spans.length !== 1) return [];
    return [{ ...p, position:spans[0].position + (utc-spans[0].utc)/1000 }];
  }).filter(p => Number.isFinite(clockSeconds(p.clock)) && timing.ranges.some(([start,end]) => p.position >= start && p.position <= end));
}
export function selectAnchors(anchors, quarter, clock) {
  const seconds = clockSeconds(clock);
  if (!Number.isFinite(seconds) || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) return { status: 'invalid', matches: [] };
  const available = anchors.filter(p => p.quarter === quarter);
  if (!available.length) return { status: 'outside', matches: [] };
  const clocks = available.map(p => clockSeconds(p.clock));
  if (seconds < Math.min(...clocks) || seconds > Math.max(...clocks)) return { status: 'outside', matches: [] };
  const distance = Math.min(...clocks.map(s => Math.abs(s - seconds)));
  return { status: 'ready', distance, matches: available.filter(p => Math.abs(clockSeconds(p.clock)-seconds) === distance) };
}
