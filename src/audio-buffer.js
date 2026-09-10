// Stereo PCM history. Nothing is uploaded or retained after disconnecting.
export class AudioHistory {
  constructor(sampleRate, seconds = 180) {
    this.sampleRate = sampleRate;
    this.capacity = Math.ceil(sampleRate * seconds);
    this.channels = [new Float32Array(this.capacity), new Float32Array(this.capacity)];
    this.written = 0;
    this.read = 0;
    this.paused = false;
    this.overrun = false;
  }
  get delay() { return (this.written - this.read) / this.sampleRate; }
  get available() { return Math.min(this.written, this.capacity) / this.sampleRate; }
  setDelay(seconds) {
    if (!Number.isFinite(seconds)) return;
    this.read = Math.max(0, this.written - Math.min(this.capacity, Math.max(0, seconds * this.sampleRate)));
    this.read = Math.floor(this.read);
  }
  seekAudioTime(seconds) {
    const target=Math.round(seconds*this.sampleRate);
    if(!Number.isFinite(target)) return {state:'invalid'};
    if(target<Math.max(0,this.written-this.capacity)) return {state:'not-buffered'};
    if(target>this.written) return {state:'audio-behind-tv'};
    this.read=target;this.paused=false;
    return {state:'applied',delay:this.delay};
  }
  process(input, output) {
    const frames = output[0].length;
    for (let i = 0; i < frames; i++) {
      // Do not invent incoming audio if a source has disconnected.
      if (input.length && input[0].length > i) {
        for (let c = 0; c < 2; c++) this.channels[c][this.written % this.capacity] = (input[c] || input[0])[i];
        this.written++;
      }
      if (this.read < this.written - this.capacity) {
        this.read = this.written - this.capacity;
        this.overrun = true;
      }
      const audible = !this.paused && this.read < this.written;
      for (let c = 0; c < output.length; c++) output[c][i] = audible ? this.channels[Math.min(c, 1)][this.read % this.capacity] : 0;
      if (audible) this.read++;
    }
  }
}
