import Hls from 'hls.js';
import { Mp3Transport } from './mp3-transport.js';
import workletURL from './audio-worklet.js?worker&url';
import { ContinuityMap, clipRanges, timestampSpans, snapshot, mapPosition, locateSeekable, planRestore } from './hls-timeline.js';
const MOVE_DEADLINE_MS = 10000, RESTORE_DEADLINE_MS = 10000, SAMPLE_EVERY_MS = 1000;
// Listener controls that win over a pending timeline restore and invalidate its cached sample.
const MOVEMENTS = new Set(['nudge', 'delay', 'live', 'pause', 'hold', 'restore']);
const monotonic = () => (typeof performance === 'undefined' ? Date.now() : performance.now());
function failure(message, kind) { const error = new Error(message); error.kind = kind; return error; }
// Owner-facing failure class. Permission and local failures keep the same source; transport and
// availability failures may move to another one. A blocked context is permission, not transport.
function classify(error, context) {
  if (error?.kind) return error.kind;
  if (error?.name === 'NotAllowedError') return 'permission';
  if (error?.message === 'source-timeout') return context?.state === 'running' ? 'transport' : 'permission';
  if (['timeout', 'disconnected', 'control-overflow', 'mp3-unsupported'].includes(error?.message)) return 'local';
  return 'transport';
}
// Graph/device initialization failures belong to this browser, never to another feed.
function localSetup(run) {
  try { return run(); }
  catch (error) { error.kind = error?.name === 'NotAllowedError' ? 'permission' : 'local'; throw error; }
}
export class Player {
  constructor(onState, onEvent) {
    this.onState = onState; this.onEvent = onEvent;
    this.epoch = 0; this.sequence = 0; this.pending = new Map(); this.state = null;
    this.continuity = new ContinuityMap(); this.movement = null; this.restore = null;
  }
  // MP3 PCM uses no media element, so callers inspect transport-neutral state.
  get sourceConnected() { return !!(this.audio || this.mp3); }
  get sourcePaused() { return !!this.audio?.paused; }
  async start(url, delay = 0, { hls = false, mp3 = false, recovery = null } = {}) {
    recovery ||= { url, hls, mp3, delay, attempts: 0, mediaSeeked: false, sample: null, restoring: false };
    this.stop(recovery);
    const epoch = this.epoch;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context || !window.AudioWorkletNode || !window.isSecureContext) throw failure('unsupported', 'environment');
    let context;
    try {
    if (mp3) try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* Unsupported. */ }
    context = this.context = localSetup(() => new Context());
    const audio = this.audio = mp3 ? null : localSetup(() => new Audio());
    if (audio) { audio.crossOrigin = 'anonymous'; audio.preload = 'none'; audio.playsInline = true; }
    const valid = () => epoch === this.epoch;
    let gapPosition = null, connected = false, transport = null;
    const position = () => transport ? transport.position : audio.currentTime;
    // Output is ready only after the graph is connected, input admitted and actual PCM rendered.
    this.output = { connected: false, baseline: null, ready: false };
    const clearStall = () => { if (this.stallTimer) clearTimeout(this.stallTimer); this.stallTimer = null; };
    const armStall = () => {
      if (!valid() || !connected || this.stallTimer || this.state?.holding || (this.state?.paused && this.state?.restoring == null)) return;
      this.stallTimer = setTimeout(() => {
        this.stallTimer = null;
        if (!valid() || this.mediaPlaying || context.state !== 'running' || this.state?.holding || (this.state?.paused && this.state?.restoring == null)) return;
        // A move owns the media; after an unconfirmed move the stall is a local alignment failure, not transport.
        if (this.movement) return;
        if (this.isolation) { this.#parkLocal(); return; }
        this.recover(recovery);
      }, 20000);
    };
    // After an unconfirmed timestamp move, media that does not resume parks this same source for Play
    // instead of spending its transport retries or advancing to another source.
    const armLocal = () => {
      if (!valid() || this.localTimer) return;
      this.localTimer = setTimeout(() => {
        this.localTimer = null;
        if (!valid() || !this.isolation || this.mediaPlaying) return;
        this.#parkLocal();
      }, 20000);
    };
    this.hooks = { armStall, armLocal, clearStall };
    const markGap = () => { if (gapPosition === null) gapPosition = Number.isFinite(position()) ? position() : NaN; };
    const ingestion = () => {
      const continuous = Number.isFinite(gapPosition) && Number.isFinite(position()) && Math.abs(position() - gapPosition) < 0.1;
      gapPosition = null;
      // Skipped source audio ends the verified media mapping; later input must verify again.
      if (!continuous) this.continuity.close();
      return continuous ? { playing: true, continuous: true } : true;
    };
    context.onstatechange = () => {
      if (!valid()) return;
      if (context.state !== 'running') {
        if (this.movement) this.#settleMove(this.movement, 'canceled');
        markGap(); this.contextInterrupted = true;
        if (this.node) this.command('interrupt').catch(() => {});
        this.onEvent('context-interrupted');
      } else if (this.contextInterrupted) {
        this.contextInterrupted = false;
        if (this.node) this.command('ingest', this.mediaPlaying ? ingestion() : false).catch(() => {});
        this.onEvent('context-restored');
      }
    };
    // Resume and media.play originate in this click; do not wait for module download first.
    const resumed = Promise.resolve(localSetup(() => context.resume())).catch(error => { error.kind = error?.name === 'NotAllowedError' ? 'permission' : 'local'; throw error; });
    resumed.catch(() => {});

    const playing = () => {
      if (!valid()) return;
      clearStall(); this.#clearLocal(); this.mediaPlaying = true;
      // A pending timeline move admits input only after confirming its new position.
      if (this.movement) { this.#checkMove(); return; }
      if (this.node && context.state === 'running') this.command('ingest', ingestion()).catch(() => {});
      this.onEvent('source-playing');
    };
    const interrupted = (kind) => {
      if (!valid()) return;
      // Buffering inside a deliberate move is part of that move, not a source interruption.
      if (this.movement && kind === 'source-waiting') { this.mediaPlaying = false; return; }
      if (this.movement) this.#settleMove(this.movement, 'canceled');
      if (kind === 'source-paused') clearStall();
      markGap(); this.mediaPlaying = false;
      if (this.node) this.command('interrupt', kind === 'source-paused').catch(() => {});
      this.onEvent(kind);
      if (['source-waiting', 'source-stalled'].includes(kind)) { if (this.isolation) armLocal(); else armStall(); }
      if (connected && ['source-ended', 'source-error'].includes(kind)) this.recover(recovery);
    };
    let failSource;
    const sourceFailure = new Promise((_, reject) => { failSource = reject; }); sourceFailure.catch(() => {});
    let source, played;
    if (mp3) {
      source = this.source = localSetup(() => context.createGain());
      source.channelCount = 2; source.channelCountMode = 'explicit'; source.channelInterpretation = 'speakers';
      transport = this.mp3 = localSetup(() => new Mp3Transport(context, source, url, (kind, error) => {
        if (!valid()) return;
        if (kind === 'playing') playing();
        else if (kind === 'error') { failSource(error); interrupted('source-error'); }
        else interrupted(kind === 'ended' ? 'source-ended' : 'source-waiting');
      }));
      localSetup(() => transport.start()); played = transport.ready;
    } else {
    audio.onplaying = playing;
    audio.onwaiting = () => interrupted('source-waiting');
    audio.onstalled = () => { if (audio.readyState < 3 && !this.movement) interrupted('source-stalled'); };
    audio.onpause = () => interrupted('source-paused');
    audio.onended = () => interrupted('source-ended');
    audio.onerror = () => interrupted('source-error');
    // A media jump this player did not request (for example HLS gap skipping) ends the verified mapping.
    audio.onseeking = () => { if (valid() && !this.movement) this.continuity.close(); };
    audio.onseeked = () => {
      if (!valid()) return;
      if (this.movement) { this.#checkMove(); return; }
      // A late seek completion after an unconfirmed move readmits input; its position stays unmapped.
      if (this.isolation && this.mediaPlaying && !audio.paused && this.node && context.state === 'running') { this.#clearLocal(); this.command('ingest', true).catch(() => {}); }
    };
    audio.onloadedmetadata = audio.oncanplay = () => { if (valid()) this.#attemptRestore(); };
    // Connect before play so the element never bypasses the delay engine.
    source = this.source = localSetup(() => context.createMediaElementSource(audio));
    if (hls && Hls.isSupported()) {
      // Catalog feeds keep their back buffer so timestamp seeks inside the playlist window stay fast.
      const transport = this.hls = new Hls({ maxBufferLength: 12, backBufferLength: 350 });
      transport.on(Hls.Events.ERROR, (_, data) => {
        if (valid() && data.fatal) { failSource(new Error('hls-error')); interrupted('source-error'); }
      });
      transport.on(Hls.Events.LEVEL_UPDATED, () => { if (valid()) this.#attemptRestore(); });
      transport.on(Hls.Events.FRAG_BUFFERED, () => { if (valid()) this.#attemptRestore(); });
      transport.loadSource(url); transport.attachMedia(audio);
    } else if (!hls || audio.canPlayType('application/vnd.apple.mpegurl')) audio.src = url;
    else { this.stop(); throw failure('hls-unsupported', 'availability'); }
    played = audio.play();
    }
    let startupTimer;
    const deadline = new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error('source-timeout')), 20000); });
    const settled = Promise.race([Promise.all([resumed, played]), deadline, sourceFailure]); settled.catch(() => {});
    try {
      const loaded = context.audioWorklet.addModule(workletURL).catch(() => { throw failure('worklet-unavailable', 'local'); });
      await Promise.race([loaded, deadline]);
      if (!valid()) return;
      const node = this.node = localSetup(() => new AudioWorkletNode(context, 'broadcast-buffer', { outputChannelCount: [2] }));
      const gain = this.gain = localSetup(() => context.createGain()); gain.gain.value = this.volume ?? 0.8;
      node.port.onmessage = ({ data }) => {
        if (!valid()) return;
        if (data.type === 'ack') {
          const pending = this.pending.get(data.id);
          if (!pending || data.epoch !== epoch) return;
          clearTimeout(pending.timer); this.pending.delete(data.id);
          this.state = { ...data.after, contextSeconds: data.contextSeconds };
          pending.resolve(data); this.onState(this.state);
        } else {
          this.state = data; this.onState(data);
          if (data.event) this.onEvent(data.event);
          if (valid()) this.#observe(data);
        }
      };
      node.onprocessorerror = () => interrupted('engine-error');
      localSetup(() => { node.connect(gain); gain.connect(context.destination); });
      // Wait for the playback gesture to settle before starting any user-command timeout.
      await settled;
      if (!valid()) return;
      // Run the output graph so the restore can be acknowledged before admitting input.
      if (delay > 0) await Promise.race([this.command('restore', delay), deadline, sourceFailure]);
      if (!valid()) return;
      localSetup(() => source.connect(node));
      // Admit decoded input before scheduling the first PCM sample.
      if (transport) this.mediaPlaying = true;
      if (valid()) await Promise.race([this.command('ingest', !!this.mediaPlaying), deadline, sourceFailure]);
      if (valid()) {
        connected = true;
        Object.assign(this.output, { connected: true, baseline: this.state?.renderedSeconds ?? 0 });
        if (transport) { transport.play(); this.onEvent('source-playing'); }
        if (!this.mediaPlaying) armStall();
        if (recovery.restoring) this.#beginRestore(recovery);
      }
    } catch (error) {
      error.kind = classify(error, context);
      if (valid()) this.stop(recovery);
      throw error;
    }
    finally { clearTimeout(startupTimer); }
    } catch (error) {
      // Errors before the media race exists are initialization failures. The inner catch already
      // classifies media failures, so preserve its transport/availability/permission disposition.
      error.kind ||= error?.name === 'NotAllowedError' ? 'permission' : 'local';
      if (epoch === this.epoch) this.stop(recovery);
      throw error;
    }
  }
  recover(session) {
    if (session !== this.recovery || this.retryTimer) return;
    const delay = this.state?.restoring ?? this.state?.resumeDelay ?? this.state?.delay ?? session.delay;
    if (Number.isFinite(delay)) session.delay = delay;
    // After a media seek the numeric delay no longer describes the position: reconnect at incoming
    // audio and restore only a verified timestamp sample.
    if (session.mediaSeeked) { session.delay = 0; session.restoring = true; }
    // A held/paused listener or suspended phone must choose when to restart.
    if (this.context?.state !== 'running' || this.state?.holding || (this.state?.paused && this.state?.restoring == null)) {
      const reason = this.context?.state !== 'running' ? 'permission' : 'paused';
      this.stop(); this.onEvent('source-reconnect-required', { reason }); this.onState(null); return;
    }
    this.scheduleRecovery(session);
  }
  scheduleRecovery(session) {
    if (session !== this.recovery) return;
    // New context/worklet discards every sample from the interrupted epoch.
    this.stop(session);
    if (session.attempts >= 3) {
      this.stop(); this.onEvent('source-reconnect-exhausted'); this.onState(null); return;
    }
    const wait = 1000 * 2 ** session.attempts++;
    this.onEvent('source-reconnecting');
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      if (session !== this.recovery) return;
      try {
        await this.start(session.url, session.delay, { hls: session.hls, mp3: session.mp3, recovery: session });
        if (session === this.recovery) this.onEvent('source-reconnected');
      } catch (error) {
        if (session !== this.recovery) return;
        // Permission, local engine and environment failures never spend the transport budget.
        if (['permission', 'local', 'environment'].includes(error?.kind) || error?.name === 'NotAllowedError') {
          this.stop(); this.onEvent('source-reconnect-required', { reason: error?.kind === 'local' || error?.kind === 'environment' ? 'local' : 'permission' }); this.onState(null);
        } else this.scheduleRecovery(session);
      }
    }, wait);
  }
  command(type, value) {
    const id = ++this.sequence, epoch = this.epoch;
    if (!this.node) return Promise.reject(new Error('disconnected'));
    const internal = ['ingest', 'interrupt', 'invalidate'].includes(type);
    // Safe lifecycle controls can wait through suspension. Bound their retained correlations.
    if (internal && [...this.pending.values()].filter(p => p.internal).length >= 64) {
      this.onEvent('control-overflow'); this.stop(); this.onState(null);
      return Promise.reject(new Error('control-overflow'));
    }
    if (MOVEMENTS.has(type) && this.output?.connected) {
      if (this.recovery) this.recovery.sample = null;
      this.#cancelRestore();
    }
    return new Promise((resolve, reject) => {
      const timer = internal ? null : setTimeout(() => {
        this.pending.delete(id);
        // Close the epoch: a queued command must never take effect later in an apparently healthy session.
        this.onEvent('command-timeout'); this.stop(); this.onState(null); reject(new Error('timeout'));
      }, 2500);
      this.pending.set(id, { resolve, reject, timer, internal });
      this.node.port.postMessage({ id, epoch, type, value });
    });
  }
  async resumeContext() {
    const epoch = this.epoch, tasks = [];
    let timer;
    try {
      if (this.context) tasks.push(this.context.resume());
      if (this.audio?.paused && !this.audio.ended) tasks.push(this.audio.play());
      await Promise.race([Promise.all(tasks), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('resume-timeout')), 5000);
      })]);
    } catch (error) {
      if (epoch === this.epoch) { this.onEvent('resume-failed'); this.stop(); this.onState(null); }
      throw error;
    } finally { clearTimeout(timer); }
  }
  setVolume(value) { this.volume = value; if (this.gain) this.gain.gain.value = value; }

  // ---------- Catalog timeline: estimated audible timestamps and verified media movement ----------
  // Audible position is the PCM read head mapped through one verified continuity interval; it is NaN
  // after any gap, drain, seek or reconnect until fresh mapped output exists. Output latency is not
  // measured, so every value here is an estimate.
  timing() {
    const audio = this.audio, details = this.hls?.latestLevelDetails, s = this.state;
    const ranges = audio ? clipRanges(audio.seekable, details) : [];
    const position = this.hls && s ? this.continuity.position(s.receivedSeconds - s.delay) : NaN;
    const snap = Number.isFinite(position) ? snapshot(details, ranges) : null;
    const at = snap?.valid ? mapPosition(snap.frags, position) : null;
    return { utc: at ? at.utc : NaN, position, ranges, spans: timestampSpans(details), input: audio?.currentTime ?? NaN };
  }
  // 'none' for non-catalog audio, 'unknown' until the playlist loads, then 'available' or 'missing'.
  timestampState() {
    if (!this.audio || !this.recovery?.hls) return 'none';
    if (!this.hls) return 'missing';
    const frags = this.hls.latestLevelDetails?.fragments;
    if (!frags?.length) return 'unknown';
    return frags.every(f => Number.isFinite(f.programDateTime)) ? 'available' : 'missing';
  }
  // Movement needs a connected catalog session whose output is running, unpaused, unheld and not restoring.
  canMove() {
    const s = this.state;
    return !!this.node && !!this.output?.connected && !!this.recovery?.hls && this.context?.state === 'running' &&
      !!s && !s.paused && !s.holding && s.restoring == null;
  }
  // Media target for Incoming audio when the input itself is far behind the live edge, otherwise null.
  liveTarget() {
    if (!this.canMove()) return null;
    const { ranges, input } = this.timing(), last = ranges.at(-1);
    return last && Number.isFinite(input) && last[1] - input > 6 ? Math.max(last[0], last[1] - 3) : null;
  }
  // A target inside verified contiguous PCM history moves the read head atomically; anything else
  // flushes PCM, moves the media and admits input only at the confirmed new position.
  async seek(position) {
    if (!this.canMove()) return { result: 'unavailable' };
    if (!Number.isFinite(position) || !this.timing().ranges.some(([a, b]) => position >= a && position <= b)) return { result: 'unavailable' };
    if (this.recovery) this.recovery.sample = null;
    this.#cancelRestore();
    const delay = this.#historyDelay(position);
    if (delay !== null) {
      const ack = await this.command('delay', delay);
      return { result: ack.result === 'applied' ? 'history' : ack.result, ack };
    }
    return this.#move(position);
  }
  #historyDelay(position) {
    const s = this.state, open = this.continuity.open;
    if (!s || !this.continuity.verified(open) || s.receivedSeconds - open.r1 > 0.25) return null;
    const coordinate = position - this.continuity.offset(open), newest = s.receivedSeconds;
    const oldest = Math.max(open.r0, newest - s.available + 0.05);
    return coordinate >= oldest && coordinate <= newest - 0.05 ? newest - coordinate : null;
  }
  #move(position, restore = false) {
    if (this.movement) this.#settleMove(this.movement, 'canceled');
    // The move owns the media from here: an earlier stall watchdog or failed-move isolation no longer applies.
    this.hooks?.clearStall(); this.#clearLocal(); this.isolation = null;
    let resolve;
    const done = new Promise(r => { resolve = r; });
    const move = this.movement = { position, epoch: this.epoch, resolve, restore, flushed: false, ingesting: false, timer: null };
    move.timer = setTimeout(() => this.#settleMove(move, 'failed'), MOVE_DEADLINE_MS);
    this.continuity.close();
    this.command('flush').then(ack => {
      if (move !== this.movement) return;
      if (ack.result !== 'applied') { this.#settleMove(move, 'unavailable'); return; }
      // Old PCM is gone and input is gated before the media element moves.
      move.flushed = true; this.continuity.clear();
      this.audio.currentTime = position;
      this.#checkMove();
    }, () => this.#settleMove(move, 'canceled'));
    return done;
  }
  #checkMove() {
    const move = this.movement, audio = this.audio;
    if (!move?.flushed || move.ingesting || move.epoch !== this.epoch || !audio) return;
    if (audio.seeking || audio.paused || !this.mediaPlaying || audio.readyState < 3 || this.context?.state !== 'running') return;
    if (!(Math.abs(audio.currentTime - move.position) <= 1)) { this.#settleMove(move, 'failed'); return; }
    move.ingesting = true;
    this.command('ingest', true).then(() => this.#settleMove(move, 'applied'), () => this.#settleMove(move, 'canceled'));
  }
  #settleMove(move, result) {
    if (move !== this.movement) return;
    clearTimeout(move.timer); this.movement = null;
    if (move.epoch === this.epoch && move.flushed) {
      if (this.recovery) this.recovery.mediaSeeked = true;
      // Unconfirmed: resume input wherever the media is; it stays unmapped until it verifies again. Until
      // verified contiguous output returns, stalls are this local failure's, never transport recovery.
      if (result === 'failed' && this.node) {
        this.continuity.clear(); this.isolation = { epoch: this.epoch };
        this.command('ingest', this.mediaPlaying && !this.audio?.seeking).catch(() => {});
        if (!this.mediaPlaying || this.audio?.seeking) this.hooks?.armLocal();
      }
    }
    move.resolve({ result });
  }
  #observe(data) {
    const audio = this.audio, context = this.context, out = this.output;
    if (this.hls && data.ingesting && this.mediaPlaying && !this.movement && !audio.seeking && context.state === 'running') this.continuity.sample(data.receivedSeconds, audio.currentTime);
    // Verified contiguous output after an unconfirmed move ends its isolation; later stalls are ordinary again.
    if (this.isolation && this.continuity.verified(this.continuity.open)) { this.isolation = null; this.#clearLocal(); }
    if (out?.connected && !out.ready && context.state === 'running' && !audio?.paused && !data.paused && !data.holding && data.restoring == null && data.renderedSeconds > out.baseline + 0.05) {
      out.ready = true; this.onEvent('output-ready');
    }
    // A media-seeked session keeps one recent audible timestamp for verified same-source restoration.
    if (this.recovery?.mediaSeeked && out?.connected && !this.restore && !this.movement && !data.paused && !data.holding && data.restoring == null && this.mediaPlaying) this.#capture();
  }
  #capture() {
    const now = monotonic();
    if (now - (this.capturedAt ?? -Infinity) < SAMPLE_EVERY_MS) return;
    const t = this.timing(), snap = Number.isFinite(t.position) ? snapshot(this.hls?.latestLevelDetails, t.ranges) : null;
    const at = snap?.valid ? locateSeekable(snap, t.position) : null;
    // An unmapped read head clears the sample and retries on the next state; a mapped one is kept per second.
    if (at) this.capturedAt = now;
    this.recovery.sample = at ? { utc: at.utc, mono: now, frags: snap.frags, index: at.index, edge: snap.edge } : null;
  }
  #beginRestore(session) {
    session.restoring = false;
    const restore = this.restore = { sample: session.sample, seeks: 0, phase: 'pending', epoch: this.epoch, plan: null };
    restore.timer = setTimeout(() => { if (this.restore === restore) this.#settleRestore('fallback', 'deadline'); }, RESTORE_DEADLINE_MS);
    this.onEvent('timeline-restoring');
    this.#attemptRestore();
  }
  // Idempotent readiness check: waits for a loaded playlist and media, then issues one bounded move.
  #attemptRestore() {
    const restore = this.restore;
    if (restore?.phase !== 'pending' || restore.epoch !== this.epoch) return;
    if (!this.hls) return this.#settleRestore('fallback', 'no-timestamps');
    if (!restore.sample) return this.#settleRestore('fallback', 'no-sample');
    if (!this.canMove() || !(this.audio.readyState >= 1)) return;
    const snap = snapshot(this.hls.latestLevelDetails, this.timing().ranges);
    if (!snap) return;
    if (!snap.valid) return this.#settleRestore('fallback', snap.reason);
    const plan = planRestore(restore.sample, snap, monotonic());
    if (!('position' in plan)) return this.#settleRestore('fallback', plan.reason);
    Object.assign(restore, { phase: 'moving', plan, seeks: restore.seeks + 1 });
    this.#move(plan.position, true).then(({ result }) => {
      if (this.restore !== restore) return;
      if (result === 'canceled') return this.#settleRestore('canceled');
      if (result === 'applied' && this.#confirmRestore(restore.plan)) return this.#settleRestore('restored');
      if (restore.seeks >= 2) return this.#settleRestore('fallback', 'moved');
      restore.phase = 'pending'; this.#attemptRestore();
    });
  }
  #confirmRestore(plan) {
    const position = this.audio?.currentTime, snap = snapshot(this.hls?.latestLevelDetails, this.timing().ranges);
    const at = snap?.valid ? locateSeekable(snap, position) : null;
    return !!at && Math.abs(at.utc - plan.utc - (position - plan.position) * 1000) <= 250;
  }
  // One terminal outcome per restoration: restored, fallback or canceled.
  #settleRestore(type, reason) {
    const restore = this.restore;
    if (!restore) return;
    clearTimeout(restore.timer); this.restore = null;
    if (type !== 'restored' && this.recovery) this.recovery.sample = null;
    this.onEvent(`timeline-${type}`, { reason, issued: restore.seeks > 0 });
  }
  #cancelRestore() { if (this.restore) this.#settleRestore('canceled'); }
  #clearLocal() { if (this.localTimer) clearTimeout(this.localTimer); this.localTimer = null; }
  // Parks the same source for Play after an unconfirmed move left media stalled: no retry budget is
  // spent and no other source is entered. A fresh Play restarts this source under the normal policy.
  #parkLocal() { this.stop(); this.onEvent('source-reconnect-required', { reason: 'seek' }); this.onState(null); }

  stop(recovery = null) {
    if (this.stallTimer) clearTimeout(this.stallTimer); this.stallTimer = null;
    this.#clearLocal(); this.isolation = null;
    if (this.retryTimer) clearTimeout(this.retryTimer); this.retryTimer = null; this.recovery = recovery;
    ++this.epoch;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('disconnected')); }
    this.pending.clear();
    if (this.movement) { const move = this.movement; this.movement = null; clearTimeout(move.timer); move.resolve({ result: 'canceled' }); }
    if (this.restore) { clearTimeout(this.restore.timer); this.restore = null; }
    this.continuity.clear(); this.output = null; this.hooks = null; this.capturedAt = undefined;
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    if (this.mp3) { this.mp3.stop(); this.source.disconnect(); this.mp3 = null; }
    if (this.audio) {
      this.audio.onplaying = this.audio.onwaiting = this.audio.onstalled = this.audio.onended = this.audio.onpause = this.audio.onerror = null;
      this.audio.onseeking = this.audio.onseeked = this.audio.onloadedmetadata = this.audio.oncanplay = null;
      this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    }
    if (this.context) { this.context.onstatechange = null; this.context.close().catch(() => {}); }
    if (this.node) this.node.port.onmessage = null;
    this.audio = this.context = this.node = this.source = this.gain = null;
    this.mediaPlaying = false; this.contextInterrupted = false; this.state = null;
  }
}
