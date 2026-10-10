import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as timeline from '../src/hls-timeline.js';
function deferred() { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject}; }
// Pure engine fixture: fake context, element, worklet port and HLS transport. No real audio, PCM or
// network; browser media proof lives in the external diagnostic. timing.media adds a seekable window,
// an element whose currentTime assignment starts a seek, and playlist details from timing.details().
function harness(timing = {}) {
  const contexts=[],audios=[],nodes=[],events=[],details=[],states=[],transports=[],mp3s=[];
  class Context {
    constructor(){if(timing.contextError)throw timing.contextError;this.state='running';this.module=deferred();this.audioWorklet={addModule:()=>this.module.promise};contexts.push(this);}
    resume(){this.state='running';return Promise.resolve();}
    close(){this.closed=true;return Promise.resolve();}
    createMediaElementSource(){if(timing.sourceError)throw timing.sourceError;return {connect(){if(timing.sourceConnectError)throw timing.sourceConnectError;}};}
    createGain(){if(timing.gainError)throw timing.gainError;const g={gain:{value:0},connect(to){g.to=to;},disconnect(){g.disconnected=true;}};return g;}
  }
  class Mp3Transport {
    constructor(context,output,url,onEvent){Object.assign(this,{context,output,url,onEvent,position:0});this.gate=deferred();this.ready=this.gate.promise;this.ready.catch(()=>{});mp3s.push(this);}
    start(){this.started=true;} play(){this.playing=true;}
    stop(){this.stopped=true;this.gate.reject(Error('aborted'));}
  }
  class Audio {
    constructor(){this.played=deferred();this.readyState=4;audios.push(this);
      if(timing.media){let time=timing.media.start??0;this.paused=false;this.seekable={length:1,start:()=>timing.media.range[0],end:()=>timing.media.range[1]};
        Object.defineProperty(this,'currentTime',{get:()=>time,set:value=>{time=value;this.seeking=true;this.assigned=(this.assigned||[]).concat(value);},configurable:true});
        this.at=value=>{time=value;};}}
    play(){return this.played.promise;}
    pause(){this.paused=true;}
    removeAttribute(){} load(){}
  }
  class Node {
    constructor(){if(timing.nodeError)throw timing.nodeError;this.messages=[];this.port={postMessage:data=>this.messages.push(data)};nodes.push(this);}
    connect(){if(timing.graphError)throw timing.graphError;}
    ack(index=0,after={delay:0,paused:false}){const m=this.messages[index];this.port.onmessage({data:{type:'ack',...m,action:m.type,type:'ack',result:'applied',after,contextSeconds:1}});}
    state(data){this.port.onmessage({data:{type:'state',event:null,paused:false,holding:false,restoring:null,ingesting:true,...data}});}
  }
  class Hls {
    static Events={ERROR:'error',LEVEL_UPDATED:'levelUpdated',FRAG_BUFFERED:'fragBuffered'};
    static isSupported(){return !!timing.hls;}
    constructor(options){this.options=options;this.handlers={};this.latestLevelDetails=timing.details?.();transports.push(this);}
    on(type,fn){this.handlers[type]=fn;}
    loadSource(url){this.url=url;}
    attachMedia(audio){this.audio=audio;}
    destroy(){this.destroyed=true;}
  }
  const sandbox=vm.createContext({...timeline,Hls,Mp3Transport,navigator:timing.navigator,window:{AudioContext:Context,AudioWorkletNode:timing.noWorklet?undefined:Node,isSecureContext:true},Audio,AudioWorkletNode:Node,workletURL:'fixture',setTimeout:timing.setTimeout || setTimeout,clearTimeout:timing.clearTimeout || clearTimeout});
  const source=fs.readFileSync(new URL('../src/player.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export class Player','class Player');
  vm.runInContext(source+'\nglobalThis.Player = Player;',sandbox);
  const player=new sandbox.Player(s=>states.push(s),(e,detail)=>{events.push(e);details.push(detail);});
  return{player,contexts,audios,nodes,events,details,states,transports,mp3s};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function connect(h){const started=h.player.start('https://fixture/stream');const a=h.audios.at(-1);a.onplaying();a.played.resolve();h.contexts.at(-1).module.resolve();await tick();h.nodes.at(-1).ack();await started;}
test('old source setup and callbacks cannot take over a newer connection',async()=>{
 const h=harness();const first=h.player.start('https://fixture/old');const oldPlaying=h.audios[0].onplaying;
 const second=h.player.start('https://fixture/new');oldPlaying();assert.equal(h.events.length,0);
 h.audios[0].played.resolve();h.contexts[0].module.resolve();await first;assert.equal(h.nodes.length,0);
 h.audios[1].onplaying();h.audios[1].played.resolve();h.contexts[1].module.resolve();await tick();h.nodes[0].ack();await second;
 assert.equal(h.contexts[0].closed,true);h.player.stop();
});
test('stop rejects pending commands; late old acknowledgments cannot update state',async()=>{
 const h=harness();await connect(h);const handler=h.nodes[0].port.onmessage;
 const command=h.player.command('nudge',.25);const rejection=assert.rejects(command,/disconnected/);h.player.stop();await rejection;
 handler({data:{type:'state',delay:99}});assert.equal(h.player.state,null);
});
test('network stall with buffered media does not stop ingestion; waiting does',async()=>{
 const h=harness();await connect(h);const node=h.nodes[0],count=node.messages.length;
 h.audios[0].onstalled();assert.equal(node.messages.length,count);
 h.audios[0].onwaiting();assert.equal(node.messages.at(-1).type,'interrupt');node.ack(node.messages.length-1);
 assert.equal(h.events.at(-1),'source-waiting');h.player.stop();
});
test('every command carries a distinct id and epoch and only its matching ack settles it',async()=>{
 const h=harness();await connect(h);const n=h.nodes[0];
 const first=h.player.command('nudge',.25), second=h.player.command('nudge',.25);
 assert.notEqual(n.messages[1].id,n.messages[2].id);assert.equal(n.messages[1].epoch,h.player.epoch);
 n.port.onmessage({data:{type:'ack',id:n.messages[1].id,epoch:-1,after:{delay:999}}});assert.equal(h.player.pending.size,2);
 n.ack(1);n.ack(2);await Promise.all([first,second]);assert.equal(h.player.pending.size,0);h.player.stop();
});
test('native source pause invalidates ingestion and Resume restarts that same media source',async()=>{
 const h=harness();await connect(h);const a=h.audios[0],n=h.nodes[0];let resumed=0;
 a.paused=true;a.onpause();assert.equal(h.events.at(-1),'source-paused');assert.equal(n.messages.at(-1).type,'interrupt');n.ack(n.messages.length-1);
 a.play=()=>{resumed++;a.paused=false;return Promise.resolve();};await h.player.resumeContext();assert.equal(resumed,1);h.player.stop();
});
test('startup timeout also covers a hung worklet module and closes its source',async()=>{
 const timers=[];const h=harness({setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{t.cleared=true;}});
 const started=h.player.start('https://fixture/stream');const rejection=assert.rejects(started,/source-timeout/);
 const deadline=timers.find(t=>t.ms===20000);deadline.fn();await rejection;
 assert.equal(h.contexts[0].closed,true);assert.equal(h.audios[0].paused,true);assert.equal(deadline.cleared,true);
});
test('command timeout closes the epoch so a late acknowledgment cannot revive or mutate playback',async()=>{
 const timers=[];const h=harness({setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;}});await connect(h);
 const node=h.nodes[0],handler=node.port.onmessage,epoch=h.player.epoch;
 const command=h.player.command('nudge',1),rejection=assert.rejects(command,/timeout/);
 timers.filter(t=>t.ms===2500 && !t.cleared).at(-1).fn();await rejection;
 assert.ok(h.player.epoch>epoch);assert.equal(h.contexts[0].closed,true);assert.equal(h.player.state,null);
 handler({data:{type:'ack',id:node.messages.at(-1).id,epoch,after:{delay:99}}});assert.equal(h.player.state,null);assert.equal(h.states.at(-1),null);
});
test('hung resume releases the operation by closing its source after a bounded deadline',async()=>{
 const timers=[];const h=harness({setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;}});await connect(h);
 h.contexts[0].resume=()=>new Promise(()=>{});
 const resumed=h.player.resumeContext(),rejection=assert.rejects(resumed,/resume-timeout/);
 timers.find(t=>t.ms===5000).fn();await rejection;assert.equal(h.contexts[0].closed,true);assert.equal(h.events.at(-1),'resume-failed');assert.equal(h.states.at(-1),null);
});
test('safe internal controls survive suspension without timeout teardown and accept later acknowledgments',async()=>{
 const timers=[];const h=harness({setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;}});await connect(h);
 const c=h.contexts[0],a=h.audios[0],n=h.nodes[0];c.state='suspended';c.onstatechange();a.paused=true;a.onpause();
 assert.deepEqual(n.messages.slice(1).map(m=>m.type),['interrupt','interrupt']);
 assert.equal(n.messages.at(-1).value,true);assert.equal(timers.filter(t=>!t.cleared && t.ms===2500).length,0);
 assert.equal(c.closed,undefined);assert.equal(h.player.pending.size,2);
 n.ack(1);n.ack(2);await tick();assert.equal(h.player.pending.size,0);assert.equal(c.closed,undefined);h.player.stop();
});
test('internal acknowledgments are bounded even through an excessive source-event storm',async()=>{
 const h=harness();await connect(h);const promises=[];
 for(let i=0;i<65;i++) promises.push(h.player.command('invalidate').catch(e=>e.message));
 await Promise.all(promises);assert.equal(h.contexts[0].closed,true);assert.equal(h.player.pending.size,0);assert.equal(h.events.at(-1),'control-overflow');
});
test('initial ingest acknowledgment remains covered by the startup deadline',async()=>{
 const timers=[];const h=harness({setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;}});
 const started=h.player.start('https://fixture/stream'),rejection=assert.rejects(started,/source-timeout/);
 h.audios[0].played.resolve();h.contexts[0].module.resolve();await tick();assert.equal(h.nodes[0].messages.length,1);
 timers.find(t=>t.ms===20000).fn();await rejection;assert.equal(h.contexts[0].closed,true);
});

test('automatic context recovery establishes a source-gap boundary before ingestion resumes',async()=>{
 const h=harness();await connect(h);const c=h.contexts[0],n=h.nodes[0];
 c.state='suspended';c.onstatechange();n.ack(1);
 c.state='running';c.onstatechange();assert.equal(n.messages[2].type,'ingest');assert.equal(n.messages[2].value,true);n.ack(2);
 assert.equal(h.events.at(-1),'context-restored');h.player.stop();
});
test('saved delay restore is acknowledged before startup admits incoming audio',async()=>{
 const h=harness();const started=h.player.start('https://fixture/stream',35);
 h.audios[0].onplaying();h.audios[0].played.resolve();h.contexts[0].module.resolve();await tick();
 const n=h.nodes[0];assert.equal(n.messages[0].type,'restore');assert.equal(n.messages[0].value,35);
 n.ack(0);await tick();assert.equal(n.messages[1].type,'ingest');n.ack(1);await started;h.player.stop();
});

test('media position continuity distinguishes a buffering pause from skipped source audio',async()=>{
 const h=harness();await connect(h);const a=h.audios[0],n=h.nodes[0];a.currentTime=10;a.onwaiting();n.ack(1);
 a.onplaying();assert.deepEqual(JSON.parse(JSON.stringify(n.messages[2].value)),{playing:true,continuous:true});n.ack(2);
 a.onwaiting();n.ack(3);a.currentTime=15;a.onplaying();assert.equal(n.messages[4].value,true);n.ack(4);h.player.stop();
});

test('saved-delay startup does not start a command timer until native playback settles',async()=>{
 const timers=[];const h=harness({setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;}});
 const started=h.player.start('https://fixture/stream',35);h.contexts[0].module.resolve();await tick();
 assert.equal(h.nodes[0].messages.length,0);assert.equal(timers.some(t=>t.ms===2500&&!t.cleared),false);
 h.audios[0].onplaying();h.audios[0].played.resolve();await tick();
 // onplaying may also send lifecycle ingestion, but source input is still disconnected.
 const n=h.nodes[0];for(let i=0;i<n.messages.length;i++)n.ack(i);await tick();
 n.ack(n.messages.length-1);await started;h.player.stop();
});
test('media resuming before its context cannot consume the continuity checkpoint',async()=>{
 const h=harness();await connect(h);const c=h.contexts[0],a=h.audios[0],n=h.nodes[0];a.currentTime=10;c.state='suspended';c.onstatechange();n.ack(1);
 a.onplaying();assert.equal(n.messages.length,2);a.currentTime=15;c.state='running';c.onstatechange();
 assert.equal(n.messages[2].type,'ingest');assert.equal(n.messages[2].value,true);n.ack(2);h.player.stop();
});

test('HLS feeds use the same worklet and restore path, and destroy transport on source switch',async()=>{
 const h=harness({hls:true});const started=h.player.start('https://fixture/live.m3u8',5,{hls:true});
 assert.equal(h.transports[0].audio,h.audios[0]);assert.equal(h.transports[0].url,'https://fixture/live.m3u8');
 h.audios[0].onplaying();h.audios[0].played.resolve();h.contexts[0].module.resolve();await tick();
 const n=h.nodes[0];assert.equal(n.messages[0].type,'restore');assert.equal(n.messages[0].value,5);n.ack(0);await tick();n.ack(1);await started;
 h.player.stop();assert.equal(h.transports[0].destroyed,true);assert.equal(h.contexts[0].closed,true);
});
test('fatal HLS startup error closes the transport and stale transport callbacks are ignored',async()=>{
 const h=harness({hls:true});const started=h.player.start('https://fixture/live.m3u8',0,{hls:true});
 const rejected=assert.rejects(started,/hls-error/);const callback=h.transports[0].handlers.error;
 callback(null,{fatal:true});h.contexts[0].module.resolve();await rejected;assert.equal(h.transports[0].destroyed,true);
 const count=h.events.length;callback(null,{fatal:true});assert.equal(h.events.length,count);
});

function recoveryHarness(options={}) {
 const timers=[];
 const h=harness({...options,setTimeout:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cleared=true;}});
 return {...h,timers,nextRetry:()=>timers.find(t=>!t.cleared&&!t.fired&&[1000,2000,4000].includes(t.ms))};
}
test('unexpected EOF reloads the same root, discards PCM and restores numerical delay before ingestion',async()=>{
 const h=recoveryHarness();await connect(h);const oldNode=h.nodes[0],oldContext=h.contexts[0];
 h.player.state={delay:35,resumeDelay:35,paused:false};h.audios[0].onended();
 assert.equal(oldContext.closed,true);assert.equal(h.player.node,null);assert.equal(h.events.at(-1),'source-reconnecting');
 const timer=h.nextRetry();assert.equal(timer.ms,1000);timer.fired=true;const retry=timer.fn();
 assert.equal(h.audios[1].src,'https://fixture/stream');h.audios[1].onplaying();h.audios[1].played.resolve();h.contexts[1].module.resolve();await tick();
 const node=h.nodes[1];assert.notEqual(node,oldNode);assert.equal(node.messages[0].type,'restore');assert.equal(node.messages[0].value,35);
 node.ack(0);await tick();assert.equal(node.messages[1].type,'ingest');node.ack(1);await retry;
 assert.equal(h.events.at(-1),'source-reconnected');h.player.stop();
});
test('stop or a source switch cancels queued reconnect without surprise playback',async()=>{
 const h=recoveryHarness();await connect(h);h.audios[0].onerror();const timer=h.nextRetry();h.player.stop();
 assert.equal(timer.cleared,true);await timer.fn();assert.equal(h.audios.length,1);
});
test('automatic reconnect has a three-attempt budget and leaves a manual recovery message',async()=>{
 const h=recoveryHarness();await connect(h);h.audios[0].onerror();
 for(const wait of [1000,2000,4000]){
  const timer=h.nextRetry();assert.equal(timer.ms,wait);timer.fired=true;const attempt=timer.fn();
  h.audios.at(-1).played.reject(Error('offline'));h.contexts.at(-1).module.resolve();await attempt;
 }
 assert.equal(h.nextRetry(),undefined);assert.equal(h.audios.length,4);assert.equal(h.events.at(-1),'source-reconnect-exhausted');assert.equal(h.states.at(-1),null);
});
test('a phone gesture restriction ends automatic attempts and requests Play',async()=>{
 const h=recoveryHarness();await connect(h);h.audios[0].onerror();const timer=h.nextRetry();timer.fired=true;const attempt=timer.fn();
 const error=Error('gesture required');error.name='NotAllowedError';h.audios.at(-1).played.reject(error);h.contexts.at(-1).module.resolve();await attempt;
 assert.equal(h.events.at(-1),'source-reconnect-required');assert.equal(h.nextRetry(),undefined);
});
test('fatal HLS after connection reloads the original gateway root, not a descendant token',async()=>{
 const h=recoveryHarness({hls:true});const root='https://gateway.example/media/game/team/one';const first=h.player.start(root,0,{hls:true});
 h.audios[0].onplaying();h.audios[0].played.resolve();h.contexts[0].module.resolve();await tick();h.nodes[0].ack();await first;
 h.transports[0].handlers.error(null,{fatal:true});const timer=h.nextRetry();timer.fired=true;const attempt=timer.fn();
 assert.equal(h.transports[1].url,root);assert.equal(h.transports[0].destroyed,true);
 h.audios[1].onplaying();h.audios[1].played.resolve();h.contexts[1].module.resolve();await tick();h.nodes[1].ack();await attempt;h.player.stop();
});

test('a sustained post-connect stall has one watchdog and short buffering cancels it',async()=>{
 const h=recoveryHarness();await connect(h);const audio=h.audios[0];
 audio.onwaiting();const timer=h.timers.find(t=>!t.cleared&&t.ms===20000);assert.ok(timer);
 audio.onwaiting();assert.equal(h.timers.filter(t=>!t.cleared&&t.ms===20000).length,1);
 audio.onplaying();assert.equal(timer.cleared,true);assert.equal(h.nextRetry(),undefined);
 audio.readyState=2;audio.onstalled();const sustained=h.timers.find(t=>!t.cleared&&t.ms===20000);sustained.fn();assert.equal(h.nextRetry().ms,1000);h.player.stop();
});
test('radio MP3 never creates a media element and schedules decoded audio only after restore and ingest are acknowledged',async()=>{
 const h=harness();const started=h.player.start('https://fixture/radio',35,{mp3:true});const t=h.mp3s[0];
 assert.equal(h.audios.length,0);assert.equal(t.started,true);assert.equal(t.url,'https://fixture/radio');
 t.gate.resolve();h.contexts[0].module.resolve();await tick();
 const n=h.nodes[0];assert.equal(n.messages[0].type,'restore');assert.equal(t.output.to,undefined);assert.equal(t.playing,undefined);
 n.ack(0);await tick();assert.equal(t.output.to,n);assert.equal(n.messages[1].type,'ingest');assert.equal(n.messages[1].value,true);assert.equal(t.playing,undefined);
 n.ack(1);await started;assert.equal(t.playing,true);assert.equal(h.events.at(-1),'source-playing');
 assert.equal(h.player.sourceConnected,true);assert.equal(h.player.sourcePaused,false);
 h.player.stop();assert.equal(t.stopped,true);assert.equal(t.output.disconnected,true);assert.equal(h.player.sourceConnected,false);
});
test('MP3 radio selects the playback audio session before its context exists; unsupported sessions do not block start',async()=>{
 const sets=[];let h;
 const run=async(...args)=>{const started=h.player.start(...args).catch(()=>{});h.player.stop();h.contexts.at(-1).module.resolve();await started;};
 h=harness({navigator:{audioSession:{set type(value){sets.push([value,h.contexts.length]);}}}});
 await run('https://fixture/radio',0,{mp3:true});assert.deepEqual(sets,[['playback',0]]);
 h=harness({navigator:{audioSession:{set type(value){throw Error('unsupported');}}}});
 await run('https://fixture/radio',0,{mp3:true});assert.equal(h.mp3s.length,1);
 h=harness({navigator:{audioSession:{set type(value){sets.push([value,'native']);}}}});
 await run('https://fixture/stream');assert.equal(sets.length,1,'native media keeps its own session');
});
test('stopping during MP3 startup aborts the transport and builds no engine',async()=>{
 const h=harness();const started=h.player.start('https://fixture/radio',0,{mp3:true});h.player.stop();
 assert.equal(h.mp3s[0].stopped,true);h.contexts[0].module.resolve();await started;assert.equal(h.nodes.length,0);assert.equal(h.contexts[0].closed,true);
});
test('MP3 starvation interrupts ingestion and resumes as continuous when no audio was skipped',async()=>{
 const h=harness();const started=h.player.start('https://fixture/radio',0,{mp3:true});const t=h.mp3s[0];
 t.gate.resolve();h.contexts[0].module.resolve();await tick();const n=h.nodes[0];n.ack(0);await started;
 t.position=12;t.onEvent('waiting');assert.equal(n.messages[1].type,'interrupt');assert.equal(h.events.at(-1),'source-waiting');n.ack(1);
 t.onEvent('playing');assert.deepEqual(JSON.parse(JSON.stringify(n.messages[2].value)),{playing:true,continuous:true});n.ack(2);
 t.onEvent('waiting');n.ack(3);t.position=20;t.onEvent('playing');assert.equal(n.messages[4].value,true);n.ack(4);h.player.stop();
});
test('MP3 decoder failure rejects startup with its reason and creates no native fallback',async()=>{
 const h=harness();const started=h.player.start('https://fixture/radio',0,{mp3:true});const rejection=assert.rejects(started,/mp3-unsupported/);
 const error=Error('mp3-unsupported');h.mp3s[0].gate.reject(error);h.mp3s[0].onEvent('error',error);h.contexts[0].module.resolve();await rejection;
 assert.equal(h.audios.length,0);assert.equal(h.contexts[0].closed,true);assert.equal(h.mp3s[0].stopped,true);
});
test('MP3 EOF reconnects through a fresh decoder transport with the saved delay, never a media element',async()=>{
 const h=recoveryHarness();const started=h.player.start('https://fixture/radio',0,{mp3:true});
 h.mp3s[0].gate.resolve();h.contexts[0].module.resolve();await tick();h.nodes[0].ack(0);await started;
 h.player.state={delay:20,resumeDelay:20,paused:false};h.mp3s[0].onEvent('ended');
 assert.equal(h.mp3s[0].stopped,true);assert.equal(h.events.at(-1),'source-reconnecting');
 const timer=h.nextRetry();timer.fired=true;const retry=timer.fn();
 assert.equal(h.mp3s.length,2);assert.equal(h.mp3s[1].url,'https://fixture/radio');assert.equal(h.audios.length,0);
 h.mp3s[1].gate.resolve();h.contexts[1].module.resolve();await tick();
 const n=h.nodes[1];assert.equal(n.messages[0].type,'restore');assert.equal(n.messages[0].value,20);n.ack(0);await tick();n.ack(1);await retry;
 assert.equal(h.mp3s[1].playing,true);assert.equal(h.events.at(-1),'source-reconnected');h.player.stop();
});
// ---------- Unified Listen engine contracts (pure fixture; no real audio or HLS) ----------
const BASE=Date.UTC(2026,9,10,19,0,0);
const playlist=(count=40)=>({fragments:Array.from({length:count},(_,i)=>({sn:i+1,cc:0,start:i*6,duration:6,programDateTime:BASE+i*6000})),edge:count*6});
const engine=(r,extra={})=>({delay:0,available:r,paused:false,holding:false,restoring:null,ingesting:true,receivedSeconds:r,renderedSeconds:r,...extra});
const media=(extra={})=>({hls:true,media:{range:[0,240],start:100},details:()=>playlist(),...extra});
async function connectHls(h,url='https://gateway.example/media/game/team/one'){
 const started=h.player.start(url,0,{hls:true});const a=h.audios.at(-1);a.onplaying();a.played.resolve();h.contexts.at(-1).module.resolve();await tick();
 const n=h.nodes.at(-1);n.ack(n.messages.length-1,engine(0));await started;return{a,n};
}
// One worklet state message while the element plays media position r + offset.
const play=(n,a,r,{offset=100,...extra}={})=>{a.at(r+offset);n.state(engine(r,extra));};
const last=n=>n.messages.length-1;

test('output-ready requires connected input and rendered PCM progression, not media playing or setup completion',async()=>{
 const h=harness();const started=h.player.start('https://fixture/stream');const a=h.audios[0];a.onplaying();a.played.resolve();h.contexts[0].module.resolve();await tick();
 const n=h.nodes[0];n.state(engine(1));assert.equal(h.events.includes('output-ready'),false,'output before input is admitted does not count');
 n.ack(0,engine(1));await started;
 assert.ok(h.events.includes('source-playing'));assert.equal(h.events.includes('output-ready'),false,'media playing and setup completion are not output');
 n.state(engine(1.02));assert.equal(h.events.includes('output-ready'),false,'no meaningful PCM progression yet');
 n.state(engine(2,{paused:true}));n.state(engine(2.5,{holding:true}));n.state(engine(3,{restoring:20}));
 assert.equal(h.events.includes('output-ready'),false,'paused, held or restoring output is not eligible');
 n.state(engine(3.5));assert.equal(h.events.filter(e=>e==='output-ready').length,1);
 n.state(engine(4));assert.equal(h.events.filter(e=>e==='output-ready').length,1,'once per physical attempt');h.player.stop();
});
test('startup failures carry an owner-facing kind: permission, transport, local and environment',async()=>{
 const kind=promise=>promise.then(()=>null,error=>error.kind);
 const denied=harness();let started=denied.player.start('https://fixture/a');const error=Error('gesture');error.name='NotAllowedError';
 denied.audios[0].played.reject(error);denied.contexts[0].module.resolve();assert.equal(await kind(started),'permission');
 for(const [state,expected] of [['suspended','permission'],['running','transport']]){
  const timers=[];const h=harness({setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;}});
  started=h.player.start('https://fixture/a');h.contexts[0].state=state;timers.find(t=>t.ms===20000).fn();assert.equal(await kind(started),expected,`deadline with a ${state} context`);
 }
 const hls=harness({hls:true});started=hls.player.start('https://fixture/live.m3u8',0,{hls:true});hls.transports[0].handlers.error(null,{fatal:true});hls.contexts[0].module.resolve();
 assert.equal(await kind(started),'transport');
 const local=harness();started=local.player.start('https://fixture/a');local.audios[0].played.resolve();local.contexts[0].module.reject(Error('module'));
 assert.equal(await kind(started),'local','a worklet module failure is a local engine failure');
 assert.equal(await kind(harness({noWorklet:true}).player.start('https://fixture/a')),'environment');
});
test('same-source retries never spend the transport budget on permission or local engine failures',async()=>{
 const h=recoveryHarness();await connect(h);h.audios[0].onerror();const timer=h.nextRetry();timer.fired=true;const attempt=timer.fn();
 h.audios.at(-1).played.resolve();h.contexts.at(-1).module.reject(Error('module'));await attempt;
 assert.equal(h.events.at(-1),'source-reconnect-required');assert.deepEqual(JSON.parse(JSON.stringify(h.details.at(-1))),{reason:'local'});assert.equal(h.nextRetry(),undefined);
 const suspended=recoveryHarness();await connect(suspended);suspended.contexts[0].state='suspended';suspended.audios[0].onerror();
 assert.equal(suspended.events.at(-1),'source-reconnect-required');assert.deepEqual(JSON.parse(JSON.stringify(suspended.details.at(-1))),{reason:'permission'});
});
test('a timestamp seek outside PCM history flushes before moving media and admits input only at the confirmed position',async()=>{
 const h=harness(media());const {a,n}=await connectHls(h);
 for(const r of [1,1.5,2,2.5])play(n,a,r);
 assert.equal(h.player.timing().position,102.5,'verified contiguous ingestion maps the read head');
 const count=n.messages.length,moving=h.player.seek(50);
 assert.deepEqual(n.messages.slice(count).map(m=>m.type),['flush']);assert.equal(a.assigned,undefined,'media does not move before the discard is acknowledged');
 n.ack(count,engine(2.5,{ingesting:false,available:0}));await tick();
 assert.deepEqual(a.assigned,[50]);assert.equal(n.messages.length,count+1,'no input is admitted while the element is still seeking');
 a.onwaiting();assert.equal(h.events.includes('source-waiting'),false,'buffering inside the move is not a source interruption');assert.equal(h.player.stallTimer,null,'the stall watchdog is not armed by the move');
 a.seeking=false;a.onseeked();assert.equal(n.messages.length,count+1,'seeked alone does not admit input while the element waits');
 a.onplaying();assert.deepEqual([n.messages[last(n)].type,n.messages[last(n)].value],['ingest',true]);
 n.ack(last(n),engine(2.5,{available:0}));assert.deepEqual(JSON.parse(JSON.stringify(await moving)),{result:'applied'});
 assert.ok(Number.isNaN(h.player.timing().position),'the moved position stays unmapped until fresh output verifies');
 for(const r of [3,3.5,4])play(n,a,r,{offset:47.5});
 const t=h.player.timing();assert.equal(t.position,51.5);assert.equal(t.utc,BASE+51500);h.player.stop();
});
test('a target inside verified contiguous PCM history moves the read head atomically and never moves media',async()=>{
 const h=harness(media());const {a,n}=await connectHls(h);
 for(let r=1;r<=10;r+=0.5)play(n,a,r);
 const count=n.messages.length,moving=h.player.seek(107);
 assert.equal(n.messages[count].type,'delay');assert.ok(Math.abs(n.messages[count].value-3)<1e-9);
 n.ack(count,engine(10,{delay:3}));assert.equal((await moving).result,'history');assert.equal(a.assigned,undefined);
 assert.equal(h.player.timing().position,107,'the audible estimate follows the PCM read head, not the newest input');
 n.state(engine(10,{delay:3,holding:true}));assert.equal(h.player.timing().position,107,'a hold keeps the retained read head mapping');
 assert.equal((await h.player.seek(104)).result,'unavailable','no movement while holding');assert.equal(n.messages.length,count+1);h.player.stop();
});
test('two rapid seeks and Stop leave no stale flush, seeked or ingest path able to move or revive playback',async()=>{
 const h=harness(media());const {a,n}=await connectHls(h);
 for(const r of [1,1.5,2,2.5])play(n,a,r);
 const first=h.player.seek(50),second=h.player.seek(60);
 assert.equal((await first).result,'canceled');
 const flushes=n.messages.flatMap((m,i)=>m.type==='flush'?[i]:[]);assert.equal(flushes.length,2);
 n.ack(flushes[0],engine(2.5,{ingesting:false}));await tick();assert.equal(a.assigned,undefined,'a superseded acknowledgement cannot move media');
 n.ack(flushes[1],engine(2.5,{ingesting:false}));await tick();assert.deepEqual(a.assigned,[60]);
 const seeked=a.onseeked,count=n.messages.length;h.player.stop();assert.equal((await second).result,'canceled');
 a.seeking=false;seeked?.();assert.equal(n.messages.length,count,'a late seeked callback after Stop sends nothing');
});
test('gaps and jumps end the audible mapping; buffered samples keep their own interval until fresh output verifies',async()=>{
 const h=harness(media());const {a,n}=await connectHls(h);
 for(const r of [1,1.5,2,2.5])play(n,a,r);
 a.onwaiting();a.at(130);a.onplaying();assert.equal(n.messages[last(n)].value,true,'a skipped source position is a discontinuous ingest');
 play(n,a,3,{offset:127});assert.ok(Number.isNaN(h.player.timing().position),'new input is unmapped until verified');
 n.state(engine(3,{delay:1}));assert.equal(h.player.timing().position,102,'buffered audio keeps its pre-gap mapping');
 n.state(engine(3,{delay:0.3}));assert.ok(Number.isNaN(h.player.timing().position),'audio received across the gap is never guessed');
 play(n,a,3.5,{offset:127});play(n,a,4,{offset:127});assert.equal(h.player.timing().position,131);
 a.onseeking();play(n,a,4.5,{offset:200});assert.ok(Number.isNaN(h.player.timing().position),'an unrequested media jump ends the mapping');h.player.stop();
});
test('after a media seek, recovery reconnects at incoming audio and restores the verified audible timestamp',async()=>{
 const timers=[];const h=harness(media({setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;}}));const {a,n}=await connectHls(h);
 for(const r of [1,1.5,2,2.5])play(n,a,r);
 const moved=h.player.seek(50);n.ack(last(n),engine(2.5,{ingesting:false}));await tick();a.seeking=false;a.onseeked();n.ack(last(n),engine(2.5));assert.equal((await moved).result,'applied');
 for(const r of [3,3.5,4])play(n,a,r,{offset:47.5});
 a.onerror();assert.equal(h.events.at(-1),'source-reconnecting');
 const timer=timers.find(t=>t.ms===1000&&!t.cleared);const retry=timer.fn();
 const a2=h.audios.at(-1);a2.onplaying();a2.played.resolve();h.contexts.at(-1).module.resolve();await tick();
 const n2=h.nodes.at(-1);assert.equal(n2.messages[0].type,'ingest','the numeric delay is not restored after a media seek');
 n2.ack(0,engine(0));await tick();
 assert.ok(h.events.includes('timeline-restoring'));assert.equal(n2.messages[1].type,'flush');
 n2.ack(1,engine(0,{ingesting:false}));await tick();assert.ok(Math.abs(a2.assigned[0]-51.5)<0.5,'the target is the captured audible position advanced by elapsed time');
 a2.seeking=false;a2.onseeked();n2.ack(last(n2),engine(0));await retry;await tick();
 assert.ok(h.events.includes('timeline-restored'));assert.ok(!h.events.includes('timeline-fallback'));h.player.stop();
});
test('without a verified sample, timeline recovery falls back honestly; a listener movement cancels a pending restore',async()=>{
 const timers=[];const options=media({setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;}});
 const h=harness(options);const {a,n}=await connectHls(h);for(const r of [1,1.5,2,2.5])play(n,a,r);
 const moved=h.player.seek(50);n.ack(last(n),engine(2.5,{ingesting:false}));await tick();a.seeking=false;a.onseeked();n.ack(last(n),engine(2.5));await moved;
 a.onerror();const retry=timers.find(t=>t.ms===1000&&!t.cleared).fn();
 const a2=h.audios.at(-1);a2.onplaying();a2.played.resolve();h.contexts.at(-1).module.resolve();await tick();h.nodes.at(-1).ack(0,engine(0));await retry;
 assert.equal(h.events.at(-1),'source-reconnected');assert.ok(h.events.includes('timeline-fallback'));
 assert.equal(h.details[h.events.indexOf('timeline-fallback')].reason,'no-sample');
 const other=harness(options);const c=await connectHls(other);for(const r of [1,1.5,2,2.5])play(c.n,c.a,r);
 const seek=other.player.seek(50);c.n.ack(last(c.n),engine(2.5,{ingesting:false}));await tick();c.a.seeking=false;c.a.onseeked();c.n.ack(last(c.n),engine(2.5));await seek;
 for(const r of [3,3.5,4])play(c.n,c.a,r,{offset:47.5});
 c.a.onerror();const again=timers.filter(t=>t.ms===1000&&!t.cleared).at(-1).fn();
 const b=other.audios.at(-1);b.readyState=0;b.onplaying();b.played.resolve();other.contexts.at(-1).module.resolve();await tick();other.nodes.at(-1).ack(0,engine(0));await again;
 assert.ok(other.events.includes('timeline-restoring'));
 other.player.command('nudge',1).catch(()=>{});assert.equal(other.events.at(-1),'timeline-canceled');other.player.stop();
});

// F1: an unconfirmed timestamp move is a local alignment failure. It must never reach transport recovery.
const fakeTimers=()=>{const timers=[];return{timers,setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;}};};
const live=(timers,ms)=>timers.timers.filter(t=>t.ms===ms&&!t.cleared&&!t.fired);
const fire=t=>{t.fired=true;return t.fn();};
const transport=h=>h.events.filter(e=>['source-reconnecting','source-reconnected','source-reconnect-exhausted'].includes(e));
test('a failed move whose media stays stalled parks the same source past the move and stall deadlines, never spending transport retries',async()=>{
 const timers=fakeTimers();const h=harness(media(timers));const {a,n}=await connectHls(h);
 for(const r of [1,1.5,2,2.5])play(n,a,r);
 a.onwaiting();const watchdog=h.player.stallTimer;assert.ok(watchdog,'an earlier buffering watchdog exists');
 const moving=h.player.seek(50);assert.equal(watchdog.cleared,true,'the move owns the media; the earlier watchdog is canceled');
 n.ack(last(n),engine(2.5,{ingesting:false}));await tick();assert.deepEqual(a.assigned,[50]);
 a.onwaiting();assert.equal(h.player.stallTimer,null,'waiting inside the move arms no watchdog');
 fire(live(timers,10000).at(-1));assert.equal((await moving).result,'failed');
 assert.equal(h.player.stallTimer,null,'the failed move arms no transport watchdog');assert.ok(h.player.localTimer,'a local park deadline is armed');
 a.readyState=2;a.onstalled();a.onwaiting();assert.equal(h.player.stallTimer,null,'late stalled and waiting callbacks stay local');
 for(const t of live(timers,20000))fire(t);
 assert.deepEqual(transport(h),[],'no reconnect, retry budget or exhaustion');
 assert.equal(h.events.at(-1),'source-reconnect-required');assert.equal(h.details.at(-1).reason,'seek');assert.equal(h.states.at(-1),null);
 assert.equal([1000,2000,4000].some(ms=>live(timers,ms).length),false,'no retry is scheduled');assert.equal(h.contexts[0].closed,true);
 for(const t of [...live(timers,20000),...live(timers,10000)])fire(t);assert.equal(transport(h).length,0,'stale deadlines stay inert');
});
test('after a failed move, a late seek completion readmits input; verified output ends isolation and later stalls use the ordinary policy',async()=>{
 const timers=fakeTimers();const h=harness(media(timers));const {a,n}=await connectHls(h);
 for(const r of [1,1.5,2,2.5])play(n,a,r);
 const moving=h.player.seek(50);n.ack(last(n),engine(2.5,{ingesting:false}));await tick();
 fire(live(timers,10000).at(-1));assert.equal((await moving).result,'failed');
 assert.deepEqual([n.messages[last(n)].type,n.messages[last(n)].value],['ingest',false],'input stays gated while the element still seeks');
 a.seeking=false;a.onseeked();assert.deepEqual([n.messages[last(n)].type,n.messages[last(n)].value],['ingest',true]);assert.equal(h.player.localTimer,null);
 for(const r of [3,3.5,4])play(n,a,r,{offset:47.5});
 assert.equal(h.player.isolation,null,'verified contiguous output ends the isolation');assert.equal(h.player.timing().position,51.5);
 a.onwaiting();assert.ok(h.player.stallTimer,'a genuine later stall arms the ordinary watchdog');
 fire(h.player.stallTimer);assert.equal(h.events.at(-1),'source-reconnecting','genuine transport failures keep their policy');h.player.stop();
});
test('a timeline restore whose moves cannot be confirmed falls back honestly and parks locally instead of reconnecting again',async()=>{
 const timers=fakeTimers();const h=harness(media(timers));const {a,n}=await connectHls(h);
 for(const r of [1,1.5,2,2.5])play(n,a,r);
 const moved=h.player.seek(50);n.ack(last(n),engine(2.5,{ingesting:false}));await tick();a.seeking=false;a.onseeked();n.ack(last(n),engine(2.5));assert.equal((await moved).result,'applied');
 for(const r of [3,3.5,4])play(n,a,r,{offset:47.5});
 a.onerror();assert.equal(transport(h).length,1);const retry=fire(live(timers,1000)[0]);
 const a2=h.audios.at(-1);a2.onplaying();a2.played.resolve();h.contexts.at(-1).module.resolve();await tick();
 const n2=h.nodes.at(-1);n2.ack(0,engine(0));await retry;await tick();assert.equal(n2.messages[1].type,'flush');
 for(const seek of [1,2]){
  n2.ack(last(n2),engine(0,{ingesting:false}));await tick();a2.onwaiting();
  assert.equal(h.player.stallTimer,null,`restore move ${seek}: no transport watchdog`);
  fire(live(timers,10000).at(-1));await tick();
 }
 assert.equal(n2.messages.filter(m=>m.type==='flush').length,2,'at most two restore moves');
 const fallback=h.events.indexOf('timeline-fallback');assert.ok(fallback>0);assert.equal(h.details[fallback].issued,true);
 for(const t of live(timers,20000))fire(t);
 assert.deepEqual(transport(h),['source-reconnecting','source-reconnected'],'only the original reconnect; no second transport recovery');
 assert.equal(h.events.at(-1),'source-reconnect-required');assert.equal(h.details.at(-1).reason,'seek');
});

test('stall watchdog cannot restart a deliberate hold, native pause, or stopped source',async()=>{
 for(const action of ['hold','pause','stop']){
  const h=recoveryHarness();await connect(h);h.audios[0].onwaiting();const timer=h.timers.find(t=>!t.cleared&&t.ms===20000);
  if(action==='hold')h.player.state={holding:true,paused:true};
  if(action==='pause')h.audios[0].onpause();
  if(action==='stop')h.player.stop();
  if(action!=='pause')timer.fn();else assert.equal(timer.cleared,true);
  assert.equal(h.nextRetry(),undefined);h.player.stop();
 }
});

test('F3 device and graph construction failures are local and clean up, while permission remains permission',async()=>{
 for(const stage of ['contextError','sourceError','nodeError','gainError','graphError','sourceConnectError']){
  const h=harness({[stage]:Error(stage)});const started=h.player.start('https://fixture/local');
  const rejected=assert.rejects(started,error=>error.kind==='local'&&error.message===stage);
  if(h.audios[0]?.onplaying){h.audios[0].onplaying();h.audios[0].played.resolve();}
  h.contexts[0]?.module.resolve();await rejected;
  assert.equal(h.player.context,null,stage);assert.equal(h.player.sourceConnected,false,stage);
  if(h.contexts[0])assert.equal(h.contexts[0].closed,true,stage);
  assert.equal(h.events.includes('source-reconnecting'),false,stage);
 }
 const error=Error('denied device');error.name='NotAllowedError';const h=harness({contextError:error});
 await assert.rejects(h.player.start('https://fixture/local'),e=>e.kind==='permission');
});
