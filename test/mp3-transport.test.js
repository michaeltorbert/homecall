import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/mp3-transport.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export class','class');
const sandbox=vm.createContext({AbortController});
vm.runInContext(source+'\nglobalThis.Mp3Transport = Mp3Transport;',sandbox);
const flush=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
const end=s=>s.at+s.buffer.length/s.buffer.sampleRate;
function stream(){
 const chunks=[],waiters=[];let failure=null,done=false;
 const reader={reads:0,read(){reader.reads++;if(chunks.length)return Promise.resolve({done:false,value:chunks.shift()});if(failure)return Promise.reject(failure);if(done)return Promise.resolve({done:true});return new Promise((res,rej)=>waiters.push({res,rej}));},cancel(){reader.cancelled=true;return Promise.resolve();}};
 const wake=()=>{while(waiters.length&&(chunks.length||done||failure)){const w=waiters.shift();if(chunks.length)w.res({done:false,value:chunks.shift()});else if(failure)w.rej(failure);else w.res({done:true});}};
 return {reader,push(bytes){chunks.push(Uint8Array.from(bytes));wake();},end(){done=true;wake();},fail(error){failure=error;wake();}};
}
// Each input byte decodes to 10 stereo frames (left = byte, right = -byte) at 1 kHz, unlike the 48 kHz context.
function decoder(){
 const d={ready:Promise.resolve(),decoded:0,decode(bytes){d.decoded++;const n=bytes.length*10,l=new Float32Array(n),r=new Float32Array(n);bytes.forEach((b,i)=>{l.fill(b,i*10,i*10+10);r.fill(-b,i*10,i*10+10);});return{channelData:[l,r],samplesDecoded:n,sampleRate:1000,errors:[]};},free(){d.freed=true;}};
 return d;
}
function setup(options={}){
 const s=stream(),d=decoder(),events=[],requests=[],output={};
 const c={sampleRate:48000,currentTime:0,sources:[],
  createBuffer(n,frames,rate){const data=Array.from({length:n},()=>new Float32Array(frames));return{numberOfChannels:n,length:frames,sampleRate:rate,getChannelData:i=>data[i]};},
  createBufferSource(){const x={connect(o){x.output=o;},disconnect(){x.disconnected=true;},start(at){x.at=at;},stop(){x.stopped=true;}};c.sources.push(x);return x;}};
 const t=new sandbox.Mp3Transport(c,output,'https://fixture/radio',(kind,error)=>events.push(error?[kind,error.message]:kind),{
  fetch:(url,init)=>{requests.push({url,init});return Promise.resolve(options.response||{ok:true,status:200,body:{getReader:()=>s.reader}});},
  decoder:options.decoder||(()=>d)});
 return {c,s,d,t,events,requests,output};
}
// Plays scheduled sources in time order, checking the scheduled lead stays bounded throughout.
async function playAll(h){
 for(;;){
  await flush();const live=h.c.sources.filter(s=>!s.done&&!s.stopped).sort((a,b)=>a.at-b.at);if(!live.length)return;
  const s=live[0];s.done=true;h.c.currentTime=end(s);s.onended?.();
  assert.ok(Math.max(...h.c.sources.map(end))-h.c.currentTime<=2.35+1e-9,'scheduled lead stays near two seconds');
 }
}
test('decoded MP3 plays in stream order, in short contiguous blocks at the decoder rate, with bounded backlog and lead',async()=>{
 const h=setup();h.t.start();for(let i=1;i<=6;i++)h.s.push(new Array(50).fill(i));await flush();
 assert.equal(h.requests[0].url,'https://fixture/radio');
 assert.equal(h.d.decoded,4,'reading pauses once two seconds are decoded but not yet scheduled');
 assert.equal(h.c.sources.length,0,'nothing is scheduled before play');
 await h.t.ready;h.t.play();await playAll(h);
 const sources=h.c.sources;
 assert.ok(sources.every(s=>s.buffer.sampleRate===1000&&s.buffer.length<=250&&s.output===h.output));
 for(let i=1;i<sources.length;i++)assert.ok(Math.abs(sources[i].at-end(sources[i-1]))<1e-9,'blocks are gapless');
 const left=sources.flatMap(s=>[...s.buffer.getChannelData(0)]),right=sources.flatMap(s=>[...s.buffer.getChannelData(1)]);
 assert.deepEqual(left,[1,2,3,4,5,6].flatMap(v=>new Array(500).fill(v)));assert.equal(right[2999],-6);
 assert.ok(sources.every(s=>s.disconnected),'finished sources leave the graph');
 assert.deepEqual(h.events,['waiting']);h.t.stop();
});
test('starvation reports waiting once and resumes only after a prebuffer, without skipping position',async()=>{
 const h=setup();h.t.start();h.s.push(new Array(50).fill(1));await flush();await h.t.ready;h.t.play();await playAll(h);
 assert.deepEqual(h.events,['waiting']);assert.equal(h.t.position,0.5);
 h.s.push(new Array(20).fill(2));await flush();assert.deepEqual(h.events,['waiting']);assert.equal(h.c.sources.filter(s=>!s.done).length,0);
 h.s.push(new Array(40).fill(3));await flush();assert.deepEqual(h.events,['waiting','playing']);
 const resumed=h.c.sources.filter(s=>!s.done);assert.ok(Math.abs(resumed[0].at-(h.c.currentTime+0.1))<1e-9);assert.equal(resumed[0].buffer.getChannelData(0)[0],2);
 h.t.stop();
});
test('EOF drains every decoded sample before reporting ended once; EOF before audio fails startup',async()=>{
 const h=setup();h.t.start();h.s.push(new Array(50).fill(1));h.s.end();await flush();await h.t.ready;h.t.play();await playAll(h);
 assert.equal(h.c.sources.reduce((n,s)=>n+s.buffer.length,0),500);assert.deepEqual(h.events,['ended']);
 const empty=setup();empty.t.start();empty.s.end();await flush();
 await assert.rejects(empty.t.ready,/source-ended/);assert.deepEqual(empty.events,[['error','source-ended']]);assert.equal(empty.d.freed,true);
});
test('stop aborts the request, frees the decoder and silences every scheduled source',async()=>{
 const h=setup();h.t.start();h.s.push(new Array(100).fill(1));await flush();await h.t.ready;h.t.play();await flush();
 const scheduled=[...h.c.sources];assert.ok(scheduled.length>1);
 h.t.stop();await flush();
 assert.ok(scheduled.every(s=>s.stopped&&s.disconnected&&s.onended===null));
 assert.equal(h.requests[0].init.signal.aborted,true);assert.equal(h.s.reader.cancelled,true);assert.equal(h.d.freed,true);
 const decoded=h.d.decoded;h.s.push(new Array(50).fill(2));await flush();
 assert.equal(h.d.decoded,decoded);assert.equal(h.c.sources.length,scheduled.length);assert.deepEqual(h.events,[]);
});
test('network failure mid-stream reports one error and tears down playback',async()=>{
 const h=setup();h.t.start();h.s.push(new Array(50).fill(1));await flush();await h.t.ready;h.t.play();await flush();
 h.s.fail(Error('network'));await flush();
 assert.deepEqual(h.events,[['error','network']]);assert.ok(h.c.sources.every(s=>s.stopped));assert.equal(h.d.freed,true);
});
test('decoder or HTTP failure rejects startup with an accurate reason',async()=>{
 const bad=setup({decoder:()=>({ready:Promise.reject(Error('wasm')),decode(){},free(){}})});bad.t.start();
 await assert.rejects(bad.t.ready,/mp3-unsupported/);await flush();assert.equal(bad.requests[0].init.signal.aborted,true);
 const http=setup({response:{ok:false,status:503}});http.t.start();
 await assert.rejects(http.t.ready,/source-http-503/);assert.deepEqual(http.events,[['error','source-http-503']]);
});
