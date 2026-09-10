import workletURL from './audio-worklet.js?worker&url';
export class Player {
  constructor(onState, onEvent) {
    this.onState = onState; this.onEvent = onEvent;
    this.epoch = 0; this.sequence = 0; this.pending = new Map(); this.state = null;
  }
  async start(url) {
    this.stop();
    const epoch = this.epoch;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context || !window.AudioWorkletNode || !window.isSecureContext) throw new Error('unsupported');
    const context = this.context = new Context();
    const audio = this.audio = new Audio();
    audio.crossOrigin = 'anonymous'; audio.preload = 'none'; audio.playsInline = true;
    const valid = () => epoch === this.epoch;
    context.onstatechange = () => {
      if (!valid()) return;
      if (context.state !== 'running') {
        if (this.node) this.command('invalidate').catch(() => {});
        this.onEvent('context-interrupted');
      }
    };
    // Resume and media.play originate in this click; do not wait for module download first.
    const resumed = context.resume();
    audio.src = url;
    audio.onplaying = () => {
      if (!valid()) return;
      this.mediaPlaying = true;
      if (this.node) this.command('ingest', true).catch(() => {});
      this.onEvent('source-playing');
    };
    const interrupted = (kind) => {
      if (!valid()) return;
      this.mediaPlaying = false;
      if (this.node) this.command('interrupt').catch(() => {});
      this.onEvent(kind);
    };
    audio.onwaiting = () => interrupted('source-waiting');
    audio.onstalled = () => { if (audio.readyState < 3) interrupted('source-stalled'); };
    audio.onended = () => interrupted('source-ended');
    audio.onerror = () => interrupted('source-error');
    // Connect before play so the element never bypasses the delay engine.
    const source = this.source = context.createMediaElementSource(audio);
    const played = audio.play();
    let startupTimer;
    const deadline = new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error('source-timeout')), 20000); });
    const settled = Promise.race([Promise.all([resumed, played]), deadline]); settled.catch(() => {});
    try {
      await context.audioWorklet.addModule(workletURL);
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
      source.connect(node); node.connect(gain); gain.connect(context.destination);
      await settled;
      if (valid()) await this.command('ingest', !!this.mediaPlaying);
    } catch (error) { if (valid()) this.stop(); throw error; }
    finally { clearTimeout(startupTimer); }
  }
  command(type, value) {
    const id = ++this.sequence, epoch = this.epoch;
    if (!this.node) return Promise.reject(new Error('disconnected'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); this.onEvent('command-timeout'); reject(new Error('timeout'));
      }, 2500);
      this.pending.set(id, { resolve, reject, timer });
      this.node.port.postMessage({ id, epoch, type, value });
    });
  }
  async resumeContext() { if (this.context) await this.context.resume(); }
  setVolume(value) { this.volume = value; if (this.gain) this.gain.gain.value = value; }
  stop() {
    ++this.epoch;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('disconnected')); }
    this.pending.clear();
    if (this.audio) {
      this.audio.onplaying = this.audio.onwaiting = this.audio.onstalled = this.audio.onended = this.audio.onerror = null;
      this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    }
    if (this.context) { this.context.onstatechange = null; this.context.close().catch(() => {}); }
    if (this.node) this.node.port.onmessage = null;
    this.audio = this.context = this.node = this.source = this.gain = null;
    this.mediaPlaying = false; this.state = null;
  }
}
