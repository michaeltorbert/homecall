import Hls from 'hls.js';
import { TIMELINE_NOTICE as NOTICE, FALLBACK_NOTICE, locateSeekable, planRestore, clipRanges, timestampSpans, snapshot } from './hls-timeline.js';
// Legacy element-based player that seeks the broadcaster's timestamped HLS window. Listen now uses
// Player's PCM engine for every source; this player and its tests remain for compatibility.
const WATCHDOG_MS = 20000, RESTORE_DEADLINE_MS = 10000, RENEW_MS = 30000;
// Per-connection handlers; private teardown clears them before its own pause()/load().
const MEDIA_HANDLERS = ['onplaying', 'onwaiting', 'onstalled', 'onpause', 'onerror', 'onended', 'ontimeupdate', 'onseeking', 'onseeked', 'onloadedmetadata', 'oncanplay'];
// Keys on the audio element that its native controls may use to move or pause audio.
const CONTROL_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', ' ', 'Spacebar', 'Enter']);

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
  // Returns true only when this event issued a seek; false lets the caller continue its guarded observation.
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
  #snapshot() { return snapshot(this.hls?.latestLevelDetails, this.timing().ranges); }
  timing() {
    const utc = this.hls?.playingDate?.getTime(), position = this.audio.currentTime;
    const details = this.hls?.latestLevelDetails;
    return { utc, position, ranges: clipRanges(this.audio.seekable, details), spans: timestampSpans(details) };
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
  // seek() owns the intent when a window exists; a second intent would erase the canceled notice.
  live() {
    const ranges = this.timing().ranges;
    if (ranges.length) return this.seek(Math.max(ranges.at(-1)[0],ranges.at(-1)[1]-3));
    this.#intent(); return false;
  }
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
