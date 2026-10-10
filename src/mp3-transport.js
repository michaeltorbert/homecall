import { MPEGDecoder } from 'mpg123-decoder';
// Safari renders a live MP3 media element outside Web Audio (WebKit bug 180696), so its sound
// bypassed Pause. Radio MP3 is decoded here instead and every sample enters the delay engine.
const SLICE = 4096;
export class Mp3Transport {
  constructor(context, output, url, onEvent, options = {}) {
    this.context = context; this.output = output; this.url = url; this.onEvent = onEvent;
    this.load = options.fetch || ((...args) => fetch(...args));
    this.createDecoder = options.decoder || (() => new MPEGDecoder());
    this.lead = options.lead ?? 2; this.limit = options.backlog ?? 2;
    this.block = options.block ?? 0.25; this.prebuffer = options.prebuffer ?? 0.5;
    this.queue = []; this.queued = 0; this.sources = new Set(); this.scheduledEnd = 0;
    // Stream seconds handed to the graph; unchanged across a starvation gap means no audio was skipped.
    this.position = 0;
    this.playing = this.starved = this.eof = this.ended = this.closed = false;
    this.controller = new AbortController(); this.wake = null;
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.ready.catch(() => {});
  }
  start() { this.run(); }
  // Scheduling waits for the caller: node hookup, restore and ingest are acknowledged first.
  play() { if (this.closed) return; this.playing = true; this.pump(); }
  async run() {
    try {
      let decoder;
      try { decoder = this.decoder = this.createDecoder(); } catch { throw new Error('mp3-unsupported'); }
      const ready = Promise.resolve(decoder.ready).catch(() => { throw new Error('mp3-unsupported'); });
      const [response] = await Promise.all([this.load(this.url, { signal: this.controller.signal, cache: 'no-store' }), ready]);
      if (this.closed) return;
      if (!response.ok || !response.body) throw new Error(`source-http-${response.status}`);
      const reader = this.reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (this.closed) return;
        if (done) break;
        for (let offset = 0; offset < value.length; offset += SLICE) {
          // Pace reading to playback so a burst or suspended context never grows an unbounded backlog.
          await this.room();
          if (this.closed) return;
          this.enqueue(decoder.decode(value.subarray(offset, offset + SLICE)));
          this.pump();
        }
      }
      this.eof = true; this.pump(); this.settle();
    } catch (error) { this.fail(error); }
  }
  room() {
    if (this.closed || this.queued < this.limit) return Promise.resolve();
    return new Promise(resolve => { this.wake = resolve; });
  }
  notify() { const wake = this.wake; this.wake = null; if (wake) wake(); }
  enqueue({ channelData, samplesDecoded, sampleRate } = {}) {
    if (!samplesDecoded || !sampleRate || !channelData?.length) return;
    // Copy out of decoder memory; the queue outlives this decode call.
    this.queue.push({ channels: channelData.map(data => data.slice(0, samplesDecoded)), rate: sampleRate, frames: samplesDecoded, offset: 0 });
    this.queued += samplesDecoded / sampleRate;
  }
  pump() {
    if (this.closed) return;
    if (!this.playing) { this.settle(); return; }
    if (this.starved && this.queued < this.prebuffer && !this.eof) return;
    const now = this.context.currentTime;
    while (this.queue.length && this.scheduledEnd - now < this.lead) {
      if (this.starved) { this.starved = false; this.onEvent('playing'); if (this.closed) return; }
      const item = this.queue[0];
      const frames = Math.min(item.frames - item.offset, Math.max(1, Math.round(this.block * item.rate)));
      // Buffers keep the decoder's rate; Web Audio resamples to the context.
      const buffer = this.context.createBuffer(item.channels.length, frames, item.rate);
      item.channels.forEach((data, channel) => buffer.getChannelData(channel).set(data.subarray(item.offset, item.offset + frames)));
      item.offset += frames;
      if (item.offset >= item.frames) this.queue.shift();
      this.queued = this.queue.length ? this.queued - frames / item.rate : 0;
      const source = this.context.createBufferSource();
      source.buffer = buffer; source.connect(this.output);
      source.onended = () => this.finished(source);
      const at = Math.max(this.scheduledEnd, now + (this.sources.size ? 0 : 0.1));
      this.sources.add(source); source.start(at);
      this.scheduledEnd = at + frames / item.rate; this.position += frames / item.rate;
    }
    this.notify();
  }
  finished(source) {
    if (this.closed || !this.sources.delete(source)) return;
    source.disconnect();
    this.pump();
    if (this.closed || this.sources.size || this.queue.length) return;
    if (this.eof) this.settle();
    else if (!this.starved) { this.starved = true; this.onEvent('waiting'); }
  }
  settle() {
    if (this.closed) return;
    if (!this.playing) {
      if (this.queued >= this.prebuffer || (this.eof && this.queue.length)) this.resolveReady();
      else if (this.eof) this.fail(new Error('source-ended'));
    } else if (this.eof && !this.queue.length && !this.sources.size && !this.ended) {
      this.ended = true; this.onEvent('ended');
    }
  }
  fail(error) {
    if (this.closed) return;
    this.rejectReady(error); this.stop(); this.onEvent('error', error);
  }
  stop() {
    if (this.closed) return;
    this.closed = true; this.rejectReady(new Error('aborted'));
    this.controller.abort();
    const reader = this.reader;
    if (reader) Promise.resolve().then(() => reader.cancel()).catch(() => {});
    try { this.decoder?.free(); } catch { /* Decoder may not have finished loading. */ }
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* Never started. */ }
      source.disconnect();
    }
    this.sources.clear(); this.queue = []; this.queued = 0; this.notify();
  }
}
