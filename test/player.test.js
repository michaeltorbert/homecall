import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function deferred() { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject}; }
function harness(timing = {}) {
  const contexts=[],audios=[],nodes=[],events=[],states=[],transports=[];
  class Context {
    constructor(){this.state='running';this.module=deferred();this.audioWorklet={addModule:()=>this.module.promise};contexts.push(this);}
    resume(){this.state='running';return Promise.resolve();}
    close(){this.closed=true;return Promise.resolve();}
    createMediaElementSource(){return {connect(){}};}
    createGain(){return {gain:{value:0},connect(){}};}
  }
  class Audio {
    constructor(){this.played=deferred();this.readyState=4;audios.push(this);}
    play(){return this.played.promise;}
    pause(){this.paused=true;}
    removeAttribute(){} load(){}
  }
  class Node {
    constructor(){this.messages=[];this.port={postMessage:data=>this.messages.push(data)};nodes.push(this);}
    connect(){}
    ack(index=0){const m=this.messages[index];this.port.onmessage({data:{type:'ack',...m,action:m.type,type:'ack',result:'applied',after:{delay:0,paused:false},contextSeconds:1}});}
  }
  class Hls {
    static Events={ERROR:'error'};
    static isSupported(){return !!timing.hls;}
    constructor(){this.handlers={};transports.push(this);}
    on(type,fn){this.handlers[type]=fn;}
    loadSource(url){this.url=url;}
    attachMedia(audio){this.audio=audio;}
    destroy(){this.destroyed=true;}
  }
  const sandbox=vm.createContext({Hls,window:{AudioContext:Context,AudioWorkletNode:Node,isSecureContext:true},Audio,AudioWorkletNode:Node,workletURL:'fixture',setTimeout:timing.setTimeout || setTimeout,clearTimeout:timing.clearTimeout || clearTimeout});
  const source=fs.readFileSync(new URL('../src/player.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export class Player','class Player');
  vm.runInContext(source+'\nglobalThis.Player = Player;',sandbox);
  const player=new sandbox.Player(s=>states.push(s),e=>events.push(e));
  return{player,contexts,audios,nodes,events,states,transports};
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
