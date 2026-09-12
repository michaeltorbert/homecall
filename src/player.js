import workletURL from './audio-worklet.js?worker&url';
export class Player {
  constructor(onState, onEvent) {
    this.onState = onState; this.onEvent = onEvent;
    this.epoch = 0; this.sequence = 0; this.pending = new Map(); this.state = null;
  }
  async start(url, delay = 0) {
    this.stop();
    const epoch = this.epoch;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context || !window.AudioWorkletNode || !window.isSecureContext) throw new Error('unsupported');
    const context = this.context = new Context();
    const audio = this.audio = new Audio();
    audio.crossOrigin = 'anonymous'; audio.preload = 'none'; audio.playsInline = true;
    const valid = () => epoch === this.epoch;
    let gapPosition = null;
    const markGap = () => { if (gapPosition === null) gapPosition = Number.isFinite(audio.currentTime) ? audio.currentTime : NaN; };
    const ingestion = () => {
      const continuous = Number.isFinite(gapPosition) && Number.isFinite(audio.currentTime) && Math.abs(audio.currentTime - gapPosition) < 0.1;
      gapPosition = null;
      return continuous ? { playing: true, continuous: true } : true;
    };
    context.onstatechange = () => {
      if (!valid()) return;
      if (context.state !== 'running') {
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
    const resumed = context.resume();
    audio.src = url;
    audio.onplaying = () => {
      if (!valid()) return;
      this.mediaPlaying = true;
      if (this.node) this.command('ingest', ingestion()).catch(() => {});
      this.onEvent('source-playing');
    };
    const interrupted = (kind) => {
      if (!valid()) return;
      markGap(); this.mediaPlaying = false;
      if (this.node) this.command('interrupt', kind === 'source-paused').catch(() => {});
      this.onEvent(kind);
    };
    audio.onwaiting = () => interrupted('source-waiting');
    audio.onstalled = () => { if (audio.readyState < 3) interrupted('source-stalled'); };
    audio.onpause = () => interrupted('source-paused');
    audio.onended = () => interrupted('source-ended');
    audio.onerror = () => interrupted('source-error');
    // Connect before play so the element never bypasses the delay engine.
    const source = this.source = context.createMediaElementSource(audio);
    const played = audio.play();
    let startupTimer;
    const deadline = new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error('source-timeout')), 20000); });
    const settled = Promise.race([Promise.all([resumed, played]), deadline]); settled.catch(() => {});
    try {
      await Promise.race([context.audioWorklet.addModule(workletURL), deadline]);
      if (!valid()) return;
      const node = this.node = new AudioWorkletNode(context, 'broadcast-buffer', { outputChannelCount: [2] });
      const gain = this.gain = context.createGain(); gain.gain.value = this.volume ?? 0.8;
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
        }
      };
      node.onprocessorerror = () => interrupted('engine-error');
      node.connect(gain); gain.connect(context.destination);
      // Run the output graph so the restore can be acknowledged before admitting input.
      if (delay > 0) await Promise.race([this.command('restore', delay), deadline]);
      if (!valid()) return;
      source.connect(node);
      await settled;
      if (valid()) await Promise.race([this.command('ingest', !!this.mediaPlaying), deadline]);
    } catch (error) { if (valid()) this.stop(); throw error; }
    finally { clearTimeout(startupTimer); }
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
  stop() {
    ++this.epoch;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('disconnected')); }
    this.pending.clear();
    if (this.audio) {
      this.audio.onplaying = this.audio.onwaiting = this.audio.onstalled = this.audio.onended = this.audio.onpause = this.audio.onerror = null;
      this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    }
    if (this.context) { this.context.onstatechange = null; this.context.close().catch(() => {}); }
    if (this.node) this.node.port.onmessage = null;
    this.audio = this.context = this.node = this.source = this.gain = null;
    this.mediaPlaying = false; this.contextInterrupted = false; this.state = null;
  }
}
