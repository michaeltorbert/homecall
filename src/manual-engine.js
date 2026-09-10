import { AudioHistory } from './audio-buffer.js';
// All timing mutations run beside the PCM history, never against a stale UI value.
export class ManualEngine {
  constructor(rate, seconds = 180) {
    this.history = new AudioHistory(rate, seconds);
    this.ingesting = false;
    this.hold = null;
    this.rendered = 0;
    this.overrunReported = false;
  }
  snapshot() {
    const h = this.history;
    return { delay: h.delay, available: h.available, paused: h.paused,
      holding: !!this.hold, ingesting: this.ingesting,
      receivedSeconds: h.written / h.sampleRate, renderedSeconds: this.rendered / h.sampleRate };
  }
  command(type, value) {
    const before = this.snapshot();
    let result = 'applied';
    const h = this.history;
    if (this.hold && ['nudge', 'delay', 'live', 'pause', 'hold'].includes(type)) result = 'holding';
    else if (type === 'nudge' && Number.isFinite(value)) h.setDelay(h.delay + value);
    else if (type === 'delay' && Number.isFinite(value)) h.setDelay(value);
    else if (type === 'live') h.setDelay(0);
    else if (type === 'pause') h.paused = !!value;
    else if (type === 'snapshot') { /* Read-only authoritative state. */ }
    else if (type === 'ingest') this.ingesting = !!value;
    else if (type === 'hold' && !h.paused && this.ingesting) {
      this.hold = { delay: h.delay, paused: h.paused }; h.paused = true;
    } else if (type === 'complete' && this.hold) { this.hold = null; h.paused = false; }
    else if (type === 'cancel' && this.hold) {
      h.setDelay(this.hold.delay); h.paused = this.hold.paused; this.hold = null;
    } else if (type === 'interrupt' || type === 'invalidate') {
      if (type === 'interrupt') this.ingesting = false;
      if (this.hold) { this.hold = null; h.paused = true; }
    } else result = 'unavailable';
    return { result, before, after: this.snapshot() };
  }
  process(input, output) {
    const h = this.history;
    const renderedBefore = h.rendered;
    h.process(this.ingesting ? input : [], output);
    // Count samples actually rendered; seeks and overwritten history are not playback.
    this.rendered += h.rendered - renderedBefore;
    if (h.overrun && !this.overrunReported) {
      this.overrunReported = true;
      this.hold = null;
      h.paused = true;
      h.overrun = false;
      return 'buffer-overrun';
    }
    if (h.delay < h.available - 0.1) this.overrunReported = false;
    h.overrun = false;
    return null;
  }
}
