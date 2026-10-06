import Hls from 'hls.js';
// Sync seeks the broadcaster's timestamped HLS window. Live's PCM delay engine is separate.
const WATCHDOG_MS = 20000, RESTORE_DEADLINE_MS = 10000, SAMPLE_TTL_MS = 120000, RENEW_MS = 30000;
// Per-connection handlers; private teardown clears them before its own pause()/load().
const MEDIA_HANDLERS = ['onplaying', 'onwaiting', 'onstalled', 'onpause', 'onerror', 'onended', 'ontimeupdate', 'onseeking', 'onseeked', 'onloadedmetadata', 'oncanplay'];
// Native-control keys that can move or pause audio. Our handler runs before the control acts.
const CONTROL_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', ' ', 'Spacebar', 'Enter']);
const NOTICE = {
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
const FALLBACK_NOTICE = { 'no-timestamps': NOTICE.timestamps, 'no-sample': NOTICE.incoming };

const validFragment = f => Number.isInteger(f.sn) && Number.isInteger(f.cc) && Number.isFinite(f.start) &&
  Number.isFinite(f.duration) && f.duration > 0 && Number.isFinite(f.pdt);
// Consecutive fragments of one playlist snapshot. cc only detects discontinuities inside that snapshot.
function continuous(prev, next) {
  const toleranceMs = Math.min(250, 250 * prev.duration);
  return next.sn === prev.sn + 1 && next.cc === prev.cc &&
    Math.abs(next.pdt - prev.pdt - prev.duration * 1000) <= toleranceMs &&
    Math.abs(next.start - prev.start - prev.duration) * 1000 <= toleranceMs;
}
// Fragments spanning the given indexes, or null when any consecutive pair is discontinuous.
function path(frags, ...indexes) {
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
function mapPosition(frags, position) {
  const index = onlyIndex(frags, f => coversPosition(f, position)), f = frags[index];
  const utc = f && f.pdt + (position - f.start) * 1000;
  return f && onlyIndex(frags, g => coversUTC(g, utc)) === index ? { index, utc } : null;
}
function mapUTC(frags, utc) {
  const index = onlyIndex(frags, f => coversUTC(f, utc)), f = frags[index];
  const position = f && f.start + (utc - f.pdt) / 1000;
  return f && onlyIndex(frags, g => coversPosition(g, position)) === index ? { index, position } : null;
}
function locateUTC(snap, utc) {
  const target = mapUTC(snap.frags, utc);
  return target && snap.ranges.some(([a, b]) => target.position >= a && target.position < b) ? target : null;
}
const locateSeekable = (snap, position) => snap.ranges.some(([a, b]) => position >= a && position <= b) ? mapPosition(snap.frags, position) : null;
// The clipped seekable endpoint. Only here may the terminal fragment's closed end be used,
// and only when no other fragment's closed span shares that endpoint position or UTC.
function locateIncomingEdge(frags, ranges) {
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
function findBridge(sample, snap, targetIndex) {
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
function planRestore(sample, snap, mono) {
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

export class SyncPlayer {
  constructor(audio, onStatus, { onRecovery = () => {}, now = () => performance.now() } = {}) {
    Object.assign(this, { audio, onStatus, onRecovery, now, epoch: 0, session: null, restore: null, health: null });
  }
  // A retained recovery session stays active through backoff so Stop remains usable.
  get active() { return !!this.session; }
  start(url) {
    this.stop();
    const session = this.session = { url, attempts: 0, sample: null, restoring: false, notice: null };
    // Native-control gestures stay observed through private restarts and backoff until Stop or a new source.
    const intent = () => { if (this.session === session) this.#intent(); };
    this.audio.onpointerdown = intent;
    this.audio.onkeydown = event => { if (CONTROL_KEYS.has(event?.key)) intent(); };
    this.#connect(session);
  }
  #connect(session) {
    const epoch = this.epoch, audio = this.audio, status = text => this.onStatus(text);
    const on = fn => (...args) => { if (epoch === this.epoch) fn(...args); };
    let userPaused = false, connected = false;
    const fail = () => this.#fail(session, userPaused);
    this.health = { last: null, healthyMs: 0 };
    if (session.restoring) {
      this.restore = { phase: 'pending', seeks: 0 };
      this.deadlineTimer = setTimeout(on(() => { this.deadlineTimer = null; this.#settle('fallback', 'deadline'); }), RESTORE_DEADLINE_MS);
    }
    const ready = on(() => this.#attemptRestore());
    audio.onloadedmetadata = audio.oncanplay = ready;
    audio.onplaying = on(() => {
      connected = true; userPaused = false; this.#clear('stallTimer'); this.#clear('startupTimer');
      status(session.restoring ? NOTICE.restoring : session.notice ?? 'Playing. Check alignment with your TV.');
      this.#attemptRestore();
    });
    audio.onwaiting = on(() => {
      this.#resetHealth(); status('Buffering…');
      if (connected && !userPaused && !this.stallTimer) this.stallTimer = setTimeout(on(() => { this.stallTimer = null; if (!userPaused) fail(); }), WATCHDOG_MS);
    });
    audio.onstalled = on(() => { if (audio.readyState < 3) audio.onwaiting?.(); });
    // A pause queued before this connection (for example by a source switch) is stale once audio plays again.
    audio.onpause = on(() => { if (!audio.paused) return; userPaused = true; this.#clear('stallTimer'); this.#resetHealth(); status('Audio paused.'); this.#intent(); });
    // Native seeking also follows HLS's own seeks, so it resets health but never cancels restoration.
    audio.onseeking = on(() => this.#resetHealth());
    audio.onseeked = on(() => { if (!this.#attemptRestore()) this.#confirmRestore(); });
    audio.ontimeupdate = on(() => { if (!this.#attemptRestore()) this.#progress(session); });
    audio.onended = on(() => { this.#resetHealth(); status('The broadcast ended.'); });
    audio.onerror = on(fail);
    if (Hls.isSupported()) {
      const hls = this.hls = new Hls({backBufferLength:350,maxBufferLength:30});
      hls.on(Hls.Events.ERROR, on((_, data) => { if (data.fatal) fail(); }));
      hls.on(Hls.Events.LEVEL_UPDATED, ready); hls.on(Hls.Events.FRAG_BUFFERED, ready);
      hls.loadSource(session.url); hls.attachMedia(audio);
    } else if (audio.canPlayType('application/vnd.apple.mpegurl')) audio.src = session.url;
    else { this.#end('HLS playback is unavailable in this browser.'); return; }
    status(session.notice ?? 'Connecting…');
    this.startupTimer = setTimeout(on(() => { this.startupTimer = null; fail(); }), WATCHDOG_MS);
    audio.play().catch(on(() => this.#end('Refresh the feed and press Play to resume.')));
  }
  #fail(session, userPaused) {
    if (session !== this.session || this.retryTimer) return;
    if (userPaused || session.attempts >= 3) { this.#end('The stream stopped. Refresh the feed and press Play to reconnect.'); return; }
    const wait = 1000 * 2 ** session.attempts++;
    this.#teardown();
    // The last healthy sample stays frozen until a restart confirms or abandons restoration.
    session.restoring = true; session.notice = session.sample ? NOTICE.reconnecting : NOTICE.reconnectingUnsampled;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; if (this.session === session) this.#connect(session); }, wait);
    this.onStatus(session.notice); this.onRecovery({ type: 'reconnecting' });
  }
  #end(message) { this.stop(); this.onStatus(message); this.onRecovery({ type: 'stopped' }); }
  // Idempotent readiness check: wait for a loaded playlist and media metadata, then issue or settle once.
  #attemptRestore() {
    if (this.restore?.phase !== 'pending') return false;
    if (!this.hls) { this.#settle('fallback', 'no-timestamps'); return false; }
    if (!this.session.sample) { this.#settle('fallback', 'no-sample'); return false; }
    const snap = this.#snapshot();
    if (!snap || !(this.audio.readyState >= 1)) return false;
    if (!snap.valid) { this.#settle('fallback', snap.reason); return false; }
    return this.#issue(planRestore(this.session.sample, snap, this.now()));
  }
  // Assignment only issues restoration; observed playback must confirm it.
  #issue(plan) {
    if (!('position' in plan)) { this.#settle('fallback', plan.reason); return false; }
    const r = this.restore;
    Object.assign(r, { phase: 'issued', seeks: r.seeks + 1, utc: plan.utc, position: plan.position, media: 0 });
    this.#resetHealth();
    this.audio.currentTime = plan.position;
    return true;
  }
  #confirmRestore() {
    const r = this.restore, a = this.audio;
    if (r?.phase !== 'issued' || a.paused || a.seeking || a.ended) return;
    const snap = this.#snapshot();
    if (!snap?.valid) return;
    const position = a.currentTime;
    const at = position >= r.position - 0.25 && position <= r.position + 0.25 + r.media ? locateSeekable(snap, position) : null;
    if (at && Math.abs(at.utc - r.utc - (position - r.position) * 1000) <= 250) this.#settle('restored');
    else if (r.seeks >= 2) this.#settle('fallback', 'moved');
    else this.#issue(planRestore(this.session.sample, snap, this.now()));
  }
  // One terminal outcome per recovery: restored, fallback or canceled.
  #settle(type, reason) {
    const session = this.session;
    if (!session?.restoring) return;
    const issued = this.restore?.phase === 'issued';
    session.restoring = false; this.restore = null; this.#clear('deadlineTimer');
    if (type !== 'restored') session.sample = null;
    session.notice = type !== 'fallback' ? NOTICE[type] : issued ? NOTICE.unconfirmed : FALLBACK_NOTICE[reason] ?? NOTICE.fallback;
    this.onStatus(session.notice); this.onRecovery({ type, reason });
  }
  // User movement or pause wins over restoration and invalidates the cached alignment sample.
  // After a completed recovery, its notice no longer describes the position the user chose.
  #intent() {
    const session = this.session;
    if (!session) return;
    session.sample = null;
    if (session.restoring) this.#settle('canceled');
    else session.notice = null;
  }
  #progress(session) {
    // A settle callback may already have stopped, replaced or failed this session.
    if (session !== this.session || !this.health) return;
    const step = this.#advance();
    if (!step) return;
    if (this.health.healthyMs >= RENEW_MS) session.attempts = 0;
    if (this.restore?.phase === 'issued') { this.restore.media += step.media; this.#confirmRestore(); }
    else if (!session.restoring) this.#capture(session, this.audio.currentTime, step.mono);
  }
  // One qualified increment of steady playback consistent with the monotonic clock, or null after resetting health.
  #advance() {
    const h = this.health, a = this.audio, mono = this.now(), media = a.currentTime, rate = a.playbackRate;
    const steady = rate > 0 && Number.isFinite(rate) && !a.paused && !a.seeking && !a.ended && a.readyState >= 3 && Number.isFinite(media) && Number.isFinite(mono);
    const last = h.last; h.last = steady ? { mono, media } : null;
    const dMono = last ? (mono - last.mono) / 1000 : NaN, dMedia = last ? media - last.media : NaN;
    if (!steady || !(dMono > 0 && dMono <= 2 && dMedia > 0 && dMedia >= 0.5 * dMono * rate && Math.abs(dMedia - dMono * rate) <= 0.5)) { h.healthyMs = 0; return null; }
    h.healthyMs += 1000 * Math.min(dMono, dMedia / rate);
    return { mono, media: dMedia };
  }
  #resetHealth() { if (this.health) this.health = { last: null, healthyMs: 0 }; }
  #capture(session, position, mono) {
    const snap = this.#snapshot(), at = snap?.valid && Number.isFinite(mono) ? locateSeekable(snap, position) : null;
    session.sample = at ? { utc: at.utc, mono, frags: snap.frags, index: at.index, edge: snap.edge } : null;
  }
  // null while the playlist or seekable window is not loaded. Invalid snapshots say whether identity or
  // timestamps are missing, or present but out of order / without a unique incoming edge.
  #snapshot() {
    const list = this.hls?.latestLevelDetails?.fragments, ranges = this.timing().ranges;
    if (!list?.length || !ranges.length) return null;
    const frags = list.map(f => ({ sn: f.sn, cc: f.cc, start: f.start, duration: f.duration, pdt: f.programDateTime }));
    if (!frags.every(validFragment)) return { frags, ranges, valid: false, reason: 'no-timestamps' };
    const edge = frags.every((f, i) => !i || f.sn > frags[i - 1].sn) ? locateIncomingEdge(frags, ranges) : null;
    return edge ? { frags, ranges, edge, valid: true } : { frags, ranges, valid: false, reason: 'invalid-playlist' };
  }
  timing() {
    const utc = this.hls?.playingDate?.getTime(), position = this.audio.currentTime;
    const details = this.hls?.latestLevelDetails;
    const lower = details?.fragments?.[0]?.start ?? -Infinity, upper = details?.edge ?? Infinity;
    const ranges = [];
    for (let i=0;i<this.audio.seekable.length;i++) {
      const start = Math.max(lower,this.audio.seekable.start(i)), end = Math.min(upper,this.audio.seekable.end(i));
      if (end > start) ranges.push([start,end]);
    }
    const spans = (details?.fragments || []).filter(f => Number.isFinite(f.programDateTime) && Number.isFinite(f.start) && Number.isFinite(f.duration) && f.duration > 0)
      .map(f => ({ utc:f.programDateTime, position:f.start, duration:f.duration }));
    return { utc, position, ranges, spans };
  }
  // Every public movement attempt wins over restoration, even when the movement itself fails.
  seek(position) {
    this.#intent();
    if (!Number.isFinite(position) || !this.timing().ranges.some(([a,b]) => position >= a && position <= b)) return false;
    this.audio.currentTime = position; this.#resetHealth();
    // Recapture from the mapped destination, never the stale playingDate.
    if (this.session) this.#capture(this.session, position, this.now());
    return true;
  }
  live() { this.#intent(); const ranges = this.timing().ranges; return ranges.length ? this.seek(Math.max(ranges.at(-1)[0],ranges.at(-1)[1]-3)) : false; }
  stop() { this.session = null; this.#teardown(); this.audio.onpointerdown = this.audio.onkeydown = null; }
  #teardown() {
    for (const timer of ['stallTimer', 'startupTimer', 'retryTimer', 'deadlineTimer']) this.#clear(timer);
    ++this.epoch; this.restore = this.health = null;
    const a = this.audio;
    for (const name of MEDIA_HANDLERS) a[name] = null;
    this.hls?.destroy(); this.hls = null;
    a.pause(); a.removeAttribute('src'); a.load();
  }
  #clear(timer) { if (this[timer]) clearTimeout(this[timer]); this[timer] = null; }
}
