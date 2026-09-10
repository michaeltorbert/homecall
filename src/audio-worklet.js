import { ManualEngine } from './manual-engine.js';
class BroadcastBuffer extends AudioWorkletProcessor {
  constructor() {
    super(); this.engine = new ManualEngine(sampleRate); this.ticks = 0;
    this.port.onmessage = ({ data }) => {
      const { id, epoch, type, value } = data;
      const result = this.engine.command(type, value);
      this.port.postMessage({ type: 'ack', id, epoch, action: type, contextSeconds: currentTime, ...result });
    };
  }
  process(inputs, outputs) {
    const event = this.engine.process(inputs[0] || [], outputs[0]);
    if (event || ++this.ticks % 30 === 0) this.port.postMessage({
      type: 'state', event, contextSeconds: currentTime, ...this.engine.snapshot()
    });
    return true;
  }
}
registerProcessor('broadcast-buffer', BroadcastBuffer);
