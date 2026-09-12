import { AudioHistory } from './audio-buffer.js';
// All timing mutations run beside the PCM history, never against a stale UI value.
export class ManualEngine {
  constructor(rate, seconds = 180) {
    this.history = new AudioHistory(rate, seconds);
    this.ingesting = false;
    this.hold = null;
    this.rendered = 0;
    this.overrunReported = false;
    this.restoring = null; this.recoveryDelay = null; this.received = 0;
  }
  snapshot() {
    const h = this.history;
    return { delay: h.delay, available: h.available, paused: h.paused,
      canResumePosition: this.recoveryDelay === null && this.restoring === null && h.delay < h.available,
      holding: !!this.hold, restoring: this.restoring, ingesting: this.ingesting,
      receivedSeconds: this.received / h.sampleRate, renderedSeconds: this.rendered / h.sampleRate };
  }
  command(type, value) {
    const before = this.snapshot();
    let result = 'applied';
    const h = this.history;
    if (type === 'restore' && Number.isFinite(value) && value >= 0 && value <= h.capacity / h.sampleRate) {
      this.hold = null; this.restoring = value; h.paused = true;
    } else if (this.restoring !== null && !['live', 'ingest', 'interrupt', 'invalidate', 'snapshot'].includes(type)) result = 'restoring';
    else if (this.hold && ['nudge', 'delay', 'live', 'pause', 'hold'].includes(type)) result = 'holding';
    else if (type === 'nudge' && Number.isFinite(value)) h.setDelay(h.delay + value);
    else if (type === 'delay' && Number.isFinite(value)) h.setDelay(value);
    else if (type === 'live') { if (this.restoring !== null) h.paused = false; this.restoring = null; this.recoveryDelay = null; h.setDelay(0); }
    else if (type === 'pause') h.paused = !!value;
    else if (type === 'snapshot') { /* Read-only authoritative state. */ }
    else if (type === 'ingest') {
      this.ingesting = value === true || value?.playing === true;
      if (this.ingesting && this.recoveryDelay !== null) {
        // Samples on opposite sides of a source gap are not a continuous timeline.
        if (value?.continuous !== true) this.history = new AudioHistory(h.sampleRate, h.capacity / h.sampleRate);
        this.restoring = this.recoveryDelay; this.recoveryDelay = null;
        this.history.paused = true;
      }
    }
    else if (type === 'hold' && !h.paused && this.ingesting) {
      this.hold = { delay: h.delay, paused: h.paused }; h.paused = true;
    } else if (type === 'complete' && this.hold) { this.hold = null; h.paused = false; }
    else if (type === 'cancel' && this.hold) {
      h.setDelay(this.hold.delay); h.paused = this.hold.paused; this.hold = null;
    } else if (type === 'interrupt' || type === 'invalidate') {
      if (type === 'interrupt') {
        if (value !== true && !h.paused && !this.hold && this.recoveryDelay === null) this.recoveryDelay = h.delay;
        else if (this.restoring !== null) this.recoveryDelay = this.restoring;
        this.ingesting = false;
        if (value === true) h.paused = true;
      }
      if (this.hold) { this.hold = null; h.paused = true; }
    } else result = 'unavailable';
    return { result, before, after: this.snapshot() };
  }
  process(input, output) {
    const h = this.history;
    if (this.ingesting && this.restoring !== null && h.available >= this.restoring) {
      h.setDelay(this.restoring); h.paused = false; this.restoring = null;
    }
    const renderedBefore = h.rendered, writtenBefore = h.written;
    h.process(this.ingesting ? input : [], output);
    this.received += h.written - writtenBefore;
    if (this.restoring !== null) h.overrun = false;
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
