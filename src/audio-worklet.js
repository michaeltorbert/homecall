import { AudioHistory } from './audio-buffer.js';
class BroadcastBuffer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.history = new AudioHistory(sampleRate);
    this.ticks = 0;
    this.analysisEnabled = false;
    this.analysisSamples = new Float32Array(sampleRate * 20);
    this.analysisCount = 0;
    this.analysisPhase = 0;
    this.analysisStart = 0;
    this.port.onmessage = ({ data }) => {
      if(data.type==='seek') {
        // Advance by command transit time in the SAME AudioContext clock.
        const elapsed=currentTime-data.requestedAtContext;
        const result=Number.isFinite(elapsed) && elapsed>=-0.05 && elapsed<2
          ? this.history.seekAudioTime(data.audioTime+Math.max(0,elapsed)) : {state:'stale'};
        this.port.postMessage({type:'seek-result',requestId:data.requestId,...result});
      }
      if (data.type === 'analysis') { this.analysisEnabled = data.value; this.analysisCount = 0; }
      if (data.type === 'pause') this.history.paused = data.value;
      if (data.type === 'delay') this.history.setDelay(data.value);
    };
  }
  process(inputs, outputs) {
    const before = this.history.written;
    this.history.process(inputs[0] || [], outputs[0]);
    if (this.analysisEnabled && inputs[0]?.[0]?.length) {
      const input=inputs[0], channels=input.length;
      for(let i=0;i<input[0].length;i++) {
        if(!this.analysisCount) this.analysisStart=(before+i)/sampleRate;
        this.analysisSamples[this.analysisCount++]=channels>1?(input[0][i]+input[1][i])/2:input[0][i];
        if(this.analysisCount===this.analysisSamples.length) {
          const samples=this.analysisSamples.slice();
          this.port.postMessage({type:'audio-window',samples,sampleRate,startSampleTime:this.analysisStart},[samples.buffer]);
          this.analysisSamples.copyWithin(0,sampleRate*10);
          this.analysisCount=sampleRate*10;this.analysisStart+=10;
        }
      }
    }
    if (++this.ticks % 30 === 0) {
      const { delay, available, paused, overrun } = this.history;
      this.port.postMessage({ delay, available, paused, overrun, liveTime:this.history.written/sampleRate });
      this.history.overrun = false;
    }
    return true;
  }
}
registerProcessor('broadcast-buffer', BroadcastBuffer);
