// Pure HLS timeline helpers shared by SyncPlayer and the Listen Player. No audio, timers or DOM.
export const SAMPLE_TTL_MS = 120000;
export const TIMELINE_NOTICE = {
  reconnecting: 'Connection lost. Reconnecting to the same broadcast; your earlier position returns only if it can be verified.',
  reconnectingUnsampled: 'Connection lost. Reconnecting to the same broadcast.',
  restoring: 'Reconnected. Returning to your earlier position; you may briefly hear incoming audio.',
  restored: 'Returned near your earlier position after reconnecting. Loading added delay; check alignment with your TV.',
  // Before any restoration seek is issued, HLS plays from its incoming default position.
  fallback: 'Your earlier position could not be verified after reconnecting, so audio plays from the incoming broadcast. Check alignment with your TV and adjust manually.',
  // After a seek was issued the position is unknown: it may be the earlier target or wherever HLS moved.
  unconfirmed: 'The return to your earlier position could not be confirmed. Check the current audio against your TV and adjust manually.',
  incoming: 'Audio resumes from the incoming broadcast. Check alignment with your TV and adjust manually.',
  timestamps: 'This browser or feed does not expose complete broadcast timestamps, so audio plays from the incoming broadcast. Check alignment with your TV and adjust manually.',
  canceled: 'Your playback change canceled the return to your earlier position. Check alignment with your TV.',
};
export const FALLBACK_NOTICE = { 'no-timestamps': TIMELINE_NOTICE.timestamps, 'no-sample': TIMELINE_NOTICE.incoming };

export const validFragment = f => Number.isInteger(f.sn) && Number.isInteger(f.cc) && Number.isFinite(f.start) &&
  Number.isFinite(f.duration) && f.duration > 0 && Number.isFinite(f.pdt);
// Consecutive fragments of one playlist snapshot. cc only detects discontinuities inside that snapshot.
export function continuous(prev, next) {
  const toleranceMs = Math.min(250, 250 * prev.duration);
  return next.sn === prev.sn + 1 && next.cc === prev.cc &&
    Math.abs(next.pdt - prev.pdt - prev.duration * 1000) <= toleranceMs &&
    Math.abs(next.start - prev.start - prev.duration) * 1000 <= toleranceMs;
}
// Fragments spanning the given indexes, or null when any consecutive pair is discontinuous.
export function path(frags, ...indexes) {
  const from = Math.min(...indexes), to = Math.max(...indexes);
  for (let i = from + 1; i <= to; i++) if (!continuous(frags[i - 1], frags[i])) return null;
  return frags.slice(from, to + 1);
}
// Half-open fragment spans; overlaps are ambiguous and gaps have no timestamp.
const coversPosition = (f, position) => position >= f.start && position < f.start + f.duration;
const coversUTC = (f, utc) => utc >= f.pdt && utc < f.pdt + f.duration * 1000;
function onlyIndex(frags, covers) {
  const hits = frags.flatMap((f, index) => covers(f) ? [index] : []);
  return hits.length === 1 ? hits[0] : -1;
}
// Both directions must identify the same single fragment. Tolerated adjacency rounding can make
// one direction unique while its inverse lands in an overlap, so neither direction alone is enough.
export function mapPosition(frags, position) {
  const index = onlyIndex(frags, f => coversPosition(f, position)), f = frags[index];
  const utc = f && f.pdt + (position - f.start) * 1000;
  return f && onlyIndex(frags, g => coversUTC(g, utc)) === index ? { index, utc } : null;
}
export function mapUTC(frags, utc) {
  const index = onlyIndex(frags, f => coversUTC(f, utc)), f = frags[index];
  const position = f && f.start + (utc - f.pdt) / 1000;
  return f && onlyIndex(frags, g => coversPosition(g, position)) === index ? { index, position } : null;
}
export function locateUTC(snap, utc) {
  const target = mapUTC(snap.frags, utc);
  return target && snap.ranges.some(([a, b]) => target.position >= a && target.position < b) ? target : null;
}
export const locateSeekable = (snap, position) => snap.ranges.some(([a, b]) => position >= a && position <= b) ? mapPosition(snap.frags, position) : null;
// The clipped seekable endpoint. Only here may the terminal fragment's closed end be used,
// and only when no other fragment's closed span shares that endpoint position or UTC.
export function locateIncomingEdge(frags, ranges) {
  const end = ranges.at(-1)[1], index = frags.length - 1, last = frags[index];
  if (Math.abs(last.start + last.duration - end) >= 1e-6) return mapPosition(frags, end);
  const utc = last.pdt + last.duration * 1000;
  const shared = frags.some((f, i) => i !== index && ((end >= f.start && end <= f.start + f.duration) || (utc >= f.pdt && utc <= f.pdt + f.duration * 1000)));
  return shared ? null : { index, utc };
}
const sameFragment = (a, b) => Math.abs(a.pdt - b.pdt) <= 250 &&
  Math.abs(a.duration - b.duration) <= Math.min(0.25, 0.25 * Math.min(a.duration, b.duration));
// A source-bound sn present in both reloads, reachable without a discontinuity from the old sample
// and, in the new snapshot, from min(bridge, target) to the incoming edge. URL and cc are not compared.
export function findBridge(sample, snap, targetIndex) {
  const index = new Map(snap.frags.map((f, i) => [f.sn, i]));
  let found = null;
  for (const [oldAt, old] of sample.frags.entries()) {
    const at = index.get(old.sn);
    if (at === undefined) continue;
    if (!sameFragment(old, snap.frags[at])) return { reason: 'identity' };
    // Once a bridge is proven, later shared fragments still need identity checks but not new paths.
    if (found) continue;
    const before = path(sample.frags, sample.index, oldAt), after = path(snap.frags, at, targetIndex, snap.edge.index);
    if (before && after) found = { relevant: [...before, ...after, sample.frags[sample.edge.index]] };
  }
  return found ?? { reason: 'continuity' };
}
// Restoration keeps the listener's real-time delay: the frozen sample advanced by elapsed monotonic time.
export function planRestore(sample, snap, mono) {
  const elapsed = mono - sample.mono;
  if (!(elapsed >= 0 && elapsed <= SAMPLE_TTL_MS)) return { reason: 'expired' };
  const utc = sample.utc + elapsed, target = locateUTC(snap, utc);
  if (!target) return { reason: 'unmapped' };
  const bridge = findBridge(sample, snap, target.index);
  if (!bridge.relevant) return bridge;
  const toleranceMs = 2000 * Math.max(...bridge.relevant.map(f => f.duration)) + 1000;
  if (Math.abs(snap.edge.utc - sample.edge.utc - elapsed) > toleranceMs) return { reason: 'edge-latency' };
  return { position: target.position, utc };
}
// Seekable ranges clipped to the loaded playlist window.
export function clipRanges(seekable, details) {
  const lower = details?.fragments?.[0]?.start ?? -Infinity, upper = details?.edge ?? Infinity;
  const ranges = [];
  for (let i = 0; i < (seekable?.length || 0); i++) {
    const start = Math.max(lower, seekable.start(i)), end = Math.min(upper, seekable.end(i));
    if (end > start) ranges.push([start, end]);
  }
  return ranges;
}
export const timestampSpans = details => (details?.fragments || []).filter(f => Number.isFinite(f.programDateTime) && Number.isFinite(f.start) && Number.isFinite(f.duration) && f.duration > 0)
  .map(f => ({ utc: f.programDateTime, position: f.start, duration: f.duration }));
// null while the playlist or seekable window is not loaded. Invalid snapshots say whether identity or
// timestamps are missing, or present but out of order / without a unique incoming edge.
export function snapshot(details, ranges) {
  const list = details?.fragments;
  if (!list?.length || !ranges.length) return null;
  const frags = list.map(f => ({ sn: f.sn, cc: f.cc, start: f.start, duration: f.duration, pdt: f.programDateTime }));
  if (!frags.every(validFragment)) return { frags, ranges, valid: false, reason: 'no-timestamps' };
  const edge = frags.every((f, i) => !i || f.sn > frags[i - 1].sn) ? locateIncomingEdge(frags, ranges) : null;
  return edge ? { frags, ranges, edge, valid: true } : { frags, ranges, valid: false, reason: 'invalid-playlist' };
}

// PCM continuity intervals. The engine's cumulative received-sample seconds are bound to media positions
// only across verified contiguous 1x ingestion. The audible read head (receivedSeconds - delay) maps
// only inside exactly one verified interval, never across a gap, drain, seek or reconnect.
export class ContinuityMap {
  constructor({ tolerance = 0.25, minSamples = 3, minSpan = 0.5, retain = 200 } = {}) {
    Object.assign(this, { tolerance, minSamples, minSpan, retain, intervals: [], open: null });
  }
  offset(interval) { return interval.sum / interval.samples; }
  verified(interval) { return !!interval && interval.samples >= this.minSamples && interval.r1 - interval.r0 >= this.minSpan; }
  // A later sample extends the open interval only at the same media-minus-PCM offset.
  sample(received, media) {
    if (!Number.isFinite(received) || !Number.isFinite(media)) { this.close(); return; }
    const open = this.open, offset = media - received;
    if (open && received >= open.r1 && media >= open.m1 - this.tolerance && Math.abs(offset - open.first) <= this.tolerance) {
      Object.assign(open, { r1: received, m1: media, sum: open.sum + offset, samples: open.samples + 1 });
    } else {
      this.open = { r0: received, m0: media, r1: received, m1: media, first: offset, sum: offset, samples: 1 };
      this.intervals.push(this.open);
    }
    this.intervals = this.intervals.filter(interval => interval.r1 >= received - this.retain);
  }
  // Ends the open interval; later input starts a new one that must verify on its own.
  close() { this.open = null; }
  clear() { this.intervals = []; this.open = null; }
  // Media position for one PCM coordinate, or NaN outside exactly one verified interval.
  position(coordinate) {
    if (!Number.isFinite(coordinate)) return NaN;
    const hits = this.intervals.filter(interval => this.verified(interval) && coordinate >= interval.r0 && coordinate <= interval.r1);
    return hits.length === 1 ? coordinate + this.offset(hits[0]) : NaN;
  }
}
