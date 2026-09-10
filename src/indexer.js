import {extractRadioClockCandidates,associateRadioPeriods} from './radio-index.js';
import { AutomaticSyncTracker } from './automatic-sync.js';
export class RadioIndexer {
  constructor(onState,sport='football') {this.sport=sport;this.onState=onState;this.candidates=[];this.tracker=new AutomaticSyncTracker();this.busy=false;this.ready=false;this.pending=null;this.streamId=crypto.randomUUID();}
  async start() {
    this.worker=new Worker(new URL('./speech-worker.js',import.meta.url),{type:'module'});
    this.worker.onmessage=({data})=>{
      if(data.type==='progress') this.onState(`Loading radio speech model · ${data.progress}%`);
      if(data.type==='ready') {this.ready=true;this.onState('Listening for clock references in Duke’s commentary…');}
      if(data.type==='error') {this.busy=false;this.ready=false;this.pending=null;this.onState('Radio recognition failed. Restart matching to try again.');}
      if(data.type==='transcript' && data.streamId===this.streamId) {
        this.busy=false;
        const incoming=extractRadioClockCandidates(data.chunks,{streamId:this.streamId,startSampleTime:data.startSampleTime,sport:this.sport});
        for(const candidate of incoming) {
          if(!Number.isFinite(data.duration) || candidate.audioEndTime>data.startSampleTime+data.duration) continue;
          if(!this.candidates.some(c=>c.clock===candidate.clock && Math.abs(c.audioTime-candidate.audioTime)<3)) this.candidates.push(candidate);
        }
        this.candidates=this.candidates.filter(c=>c.audioTime>data.startSampleTime-180);
        this.onState(this.candidates.length?`Found ${this.candidates.length} radio clock reference${this.candidates.length===1?'':'s'}. Checking timing evidence…`:'Listening for a clear game-clock reference…');
        const pending=this.pending;this.pending=null;if(pending) void this.feed(pending);
      }
    };
    this.worker.onerror=()=>{this.ready=false;this.busy=false;this.pending=null;this.onState('The local speech reader could not start.');};
    this.worker.postMessage({type:'load'});
  }
  async feed(data) {
    if(!this.ready) return;
    if(this.busy) {this.pending=data;this.onState('Radio recognition is catching up. Keeping the newest audio ready to analyze…');return;}
    this.busy=true;
    const worker=this.worker;
    try {
      const renderer=new OfflineAudioContext(1,Math.ceil(data.samples.length*16000/data.sampleRate),16000);
      const buffer=renderer.createBuffer(1,data.samples.length,data.sampleRate);
      buffer.copyToChannel(data.samples,0);
      const source=renderer.createBufferSource();source.buffer=buffer;source.connect(renderer.destination);source.start();
      const rendered=await renderer.startRendering();
      if(this.worker!==worker) return;
      const samples=rendered.getChannelData(0).slice();
      worker.postMessage({type:'transcribe',samples,startSampleTime:data.startSampleTime,streamId:this.streamId},[samples.buffer]);
    } catch {if(this.worker===worker){this.busy=false;this.onState('Unable to prepare radio audio for recognition.');}}
  }
  observe(observation,bounds) {
    if(observation.state!=='read') {this.tracker.reset();return {state:observation.state,canApply:false};}
    const associated=associateRadioPeriods(this.candidates,{streamId:this.streamId,sport:this.sport});
    return this.tracker.observe(observation,associated,{streamId:this.streamId,sport:this.sport,...bounds});
  }

  stop(){if(this.worker){this.worker.onmessage=null;this.worker.onerror=null;this.worker.terminate();}this.worker=null;this.pending=null;this.candidates=[];this.ready=false;this.busy=false;}
}
