import test from 'node:test';
import assert from 'node:assert/strict';
import {RadioIndexer} from '../src/indexer.js';

function setup(t) {
 const originalWorker=globalThis.Worker,originalRenderer=globalThis.OfflineAudioContext;
 const workers=[];
 globalThis.Worker=class {
  constructor(){this.sent=[];workers.push(this);}
  postMessage(data){this.sent.push(data);}
  terminate(){this.terminated=true;}
 };
 globalThis.OfflineAudioContext=class {
  constructor(channels,length){this.length=length;}
  createBuffer(){return {copyToChannel(){}};}
  createBufferSource(){return {connect(){},start(){}};}
  async startRendering(){return {getChannelData:()=>new Float32Array(this.length)};}
 };
 t.after(()=>{globalThis.Worker=originalWorker;globalThis.OfflineAudioContext=originalRenderer;});
 return workers;
}
const audio=startSampleTime=>({samples:new Float32Array(20),sampleRate:16000,startSampleTime});
test('slow recognition holds only the latest pending window and processes it next',async t=>{
 const workers=setup(t),states=[],indexer=new RadioIndexer(s=>states.push(s));
 await indexer.start();const worker=workers[0];worker.onmessage({data:{type:'ready'}});
 await indexer.feed(audio(0));await indexer.feed(audio(10));await indexer.feed(audio(20));
 assert.equal(worker.sent.filter(m=>m.type==='transcribe').length,1);
 assert.match(states.at(-1),/catching up/);
 worker.onmessage({data:{type:'transcript',streamId:indexer.streamId,chunks:[],duration:20,startSampleTime:0}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(worker.sent.filter(m=>m.type==='transcribe').map(m=>m.startSampleTime),[0,20]);
 indexer.stop();
});
test('stopping recognition discards queued audio and detaches worker callbacks',async t=>{
 const workers=setup(t),indexer=new RadioIndexer(()=>{});
 await indexer.start();workers[0].onmessage({data:{type:'ready'}});
 await indexer.feed(audio(0));await indexer.feed(audio(10));indexer.stop();
 assert.equal(indexer.pending,null);assert.equal(workers[0].onmessage,null);assert.equal(workers[0].terminated,true);
 await indexer.feed(audio(20));
 assert.equal(workers[0].sent.filter(m=>m.type==='transcribe').length,1);
});
