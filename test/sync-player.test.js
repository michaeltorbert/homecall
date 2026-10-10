import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as timeline from '../src/hls-timeline.js';
function harness(native=false,timing={}){
 const instances=[],events=[],recoveries=[],hooks={},clock={now:0};const audio={currentTime:10,seekable:{length:1,start:()=>0,end:()=>40},play:()=>Promise.resolve(),pause(){},removeAttribute(){},load(){},canPlayType:()=> 'maybe'};
 class Hls {static isSupported(){return !native}static Events={ERROR:'error',LEVEL_UPDATED:'levelUpdated',FRAG_BUFFERED:'fragBuffered'};constructor(){instances.push(this);this.handlers={};this.playingDate=new Date(100000);this.latestLevelDetails={fragments:[{start:15}],edge:35}}on(e,f){(this.handlers[e]||=[]).push(f);if(e==='error')this.error=f}emit(e,data={}){for(const f of this.handlers[e]||[])f(e,data)}loadSource(u){this.url=u}attachMedia(a){this.audio=a}destroy(){this.destroyed=true}}
 const context=vm.createContext({Hls,...timeline,NOTICE:timeline.TIMELINE_NOTICE,setTimeout:timing.setTimeout||setTimeout,clearTimeout:timing.clearTimeout||clearTimeout});vm.runInContext(fs.readFileSync(new URL('../src/sync-player.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export class','class')+';globalThis.SyncPlayer=SyncPlayer;',context);
 const player=new context.SyncPlayer(audio,s=>events.push(s),{onRecovery:e=>{recoveries.push(e);hooks.recovery?.(e);},now:()=>clock.now});return{player,audio,instances,events,recoveries,hooks,clock};
}
test('Sync bounds restrict seeks to the current playlist; stop unloads media and ignores old callbacks',()=>{
 const h=harness();h.player.start('https://gateway.example/media/game/team/one');const old=h.audio.onplaying;
 assert.equal(h.player.timing().utc,100000);assert.equal(h.player.seek(10),false);assert.equal(h.player.seek(20),true);assert.equal(h.audio.currentTime,20);
 assert.equal(h.player.live(),true);assert.equal(h.audio.currentTime,32);h.player.stop();const count=h.events.length;old();assert.equal(h.events.length,count);assert.ok(h.instances[0].destroyed);
});
test('native HLS never invents real-time timestamps',()=>{const h=harness(true);h.player.start('https://gateway.example/media/game/team/one');assert.equal(h.player.timing().utc,undefined);assert.equal(h.audio.src,'https://gateway.example/media/game/team/one');h.player.stop()});

function retryHarness(){
 const timers=[];const h=harness(false,{setTimeout:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cleared=true;}});
 return {...h,timers,next:()=>timers.find(t=>!t.cleared&&!t.fired&&t.ms<20000)};
}
test('Sync terminal HLS failures retry the root at most three times and stop cancels retries',()=>{
 const h=retryHarness(),root='https://gateway.example/media/game/team/one';h.player.start(root);
 for(const wait of [1000,2000,4000]){
  h.instances.at(-1).error(null,{fatal:true});const timer=h.next();assert.equal(timer.ms,wait);timer.fired=true;timer.fn();assert.equal(h.instances.at(-1).url,root);
 }
 h.instances.at(-1).error(null,{fatal:true});assert.equal(h.next(),undefined);assert.match(h.events.at(-1),/press Play/);assert.equal(h.player.active,false);
 const other=retryHarness();other.player.start(root);other.instances[0].error(null,{fatal:true});const timer=other.next();other.player.stop();timer.fn();assert.equal(other.instances.length,1);
});
test('Sync startup silence is bounded and a deliberate pause does not restart playback',()=>{
 const h=retryHarness();h.player.start('https://gateway.example/media/game/team/one');h.timers.find(t=>t.ms===20000).fn();assert.equal(h.next().ms,1000);h.player.stop();
 const paused=retryHarness();paused.player.start('https://gateway.example/media/game/team/one');paused.audio.paused=true;paused.audio.onpause();paused.instances[0].error(null,{fatal:true});assert.equal(paused.next(),undefined);assert.match(paused.events.at(-1),/press Play/);
});

test('Sync post-start buffering watchdog is bounded and canceled by playback, pause and stop',()=>{
 const h=retryHarness();h.player.start('https://gateway.example/media/game/team/one');h.audio.onwaiting();assert.equal(h.timers.filter(t=>!t.cleared&&t.ms===20000).length,1);
 h.audio.onplaying();h.audio.onwaiting();const timer=h.timers.find(t=>!t.cleared&&t.ms===20000);h.audio.onwaiting();assert.equal(h.timers.filter(t=>!t.cleared&&t.ms===20000).length,1);
 h.audio.onplaying();assert.equal(timer.cleared,true);
 h.audio.onwaiting();const paused=h.timers.find(t=>!t.cleared&&t.ms===20000);h.audio.paused=true;h.audio.onpause();assert.equal(paused.cleared,true);
 h.audio.paused=false;h.audio.onplaying();h.audio.readyState=2;h.audio.onstalled();h.timers.find(t=>!t.cleared&&t.ms===20000).fn();assert.equal(h.next().ms,1000);h.player.stop();assert.equal(h.next(),undefined);
});

const ROOT='https://gateway.example/media/game/team/one',P=1_700_000_000_000,EMPTY={length:0,start(){},end(){}};
// Fake timers, a monotonic clock and a recorded currentTime: `assigned` lists only player/test assignments, setTime moves playback silently.
function rig(native=false){
 const timers=[];const h=harness(native,{setTimeout:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cleared=true;}});
 let time=0;const assigned=[];
 Object.defineProperty(h.audio,'currentTime',{get:()=>time,set:v=>{time=v;assigned.push(v);},configurable:true});
 Object.assign(h.audio,{playbackRate:1,paused:false,seeking:false,ended:false,readyState:4,seekable:EMPTY,load(){this.seekable=EMPTY;}});
 const pending=ms=>timers.filter(t=>!t.cleared&&!t.fired&&(ms===undefined?t.ms<10000:t.ms===ms));
 return {...h,timers,assigned,pending,fire:t=>{t.fired=true;t.fn();},setTime:v=>{time=v;},types:()=>h.recoveries.map(e=>e.type),last:()=>h.recoveries.at(-1)};
}
// Fragment n has PDT P+(n-100) s by default, so sequence numbers and UTC agree across reloads unless a test changes them.
const frags=(first,{count=30,start=0,pdt=P+(first-100)*1000,duration=1,step=duration*1000,cc=0}={})=>Array.from({length:count},(_,i)=>({sn:first+i,cc,start:start+i*duration,duration,programDateTime:pdt+i*step}));
function publish(h,list,end,begin){const last=list.at(-1),edge=last.start+last.duration;h.instances.at(-1).latestLevelDetails={fragments:list,edge};h.audio.seekable={length:1,start:()=>begin??list[0].start,end:()=>end??edge};}
const update=(h,list,end,begin)=>{publish(h,list,end,begin);h.instances.at(-1).emit('levelUpdated');};
const play=(h,seconds,media=0.25)=>{for(let i=0;i<Math.round(seconds*4);i++){h.clock.now+=250;h.setTime(h.audio.currentTime+media);h.audio.ontimeupdate();}};
// Old playlist sn 100-129 (edge P+30 s). After one second of qualified playback the sample is P+20 s at monotonic 51 s.
function healthy(h,list=frags(100)){h.player.start(ROOT);publish(h,list);h.clock.now=50000;h.setTime(19);h.audio.onplaying();play(h,1);}
function reconnect(h,at){h.instances.at(-1).error(null,{fatal:true});const [retry]=h.pending();h.clock.now=at;h.fire(retry);h.instances.at(-1).latestLevelDetails=null;}
function retryAfter(h){h.instances.at(-1).error(null,{fatal:true});const [retry]=h.pending();h.fire(retry);return retry.ms;}
function restoreWith(list,{at=54000,end,begin,old}={}){const h=rig();healthy(h,old);reconnect(h,52000);h.clock.now=at;update(h,list,end,begin);return h;}
const CONTROL_KEYS=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown',' ','Spacebar','Enter'];

test('Sync renews rapid retries only after 30 s of continuously qualified progression',()=>{
 const h=rig();h.player.start(ROOT);
 assert.equal(retryAfter(h),1000);h.audio.onplaying();play(h,30);
 assert.equal(retryAfter(h),2000,'29.75 s of qualified progression is not enough');h.audio.onplaying();play(h,30.25);
 assert.equal(retryAfter(h),1000,'30 s of qualified progression renews the rapid retries');
 for(let i=0;i<40;i++){h.audio.onplaying();h.clock.now+=1000;h.audio.ontimeupdate();}
 assert.equal(retryAfter(h),2000,'playing events and elapsed time alone do not renew');
 h.audio.onplaying();play(h,20);assert.equal(retryAfter(h),4000);
 h.audio.onplaying();play(h,20);h.instances.at(-1).error(null,{fatal:true});
 assert.equal(h.player.active,false);assert.match(h.events.at(-1),/press Play/);assert.equal(h.last().type,'stopped');
});
test('frozen, near-frozen and jumping media never renew retries',()=>{
 for(const [label,media] of [['frozen',0],['near-frozen',0.1],['jumping',1]]){
  const h=rig();h.player.start(ROOT);retryAfter(h);h.audio.onplaying();play(h,40,media);assert.equal(retryAfter(h),2000,label);
 }
});
test('pause, waiting, stalls, seeking, ended, low readiness and clock gaps reset qualified progression',()=>{
 const breaks={
  none:()=>{},
  waiting:h=>h.audio.onwaiting(),
  stalled:h=>{h.audio.readyState=2;h.audio.onstalled();h.audio.readyState=4;},
  'pause event':h=>{h.audio.paused=true;h.audio.onpause();h.audio.paused=false;h.audio.onplaying();},
  paused:h=>{h.audio.paused=true;play(h,0.25);h.audio.paused=false;},
  seeking:h=>{h.audio.seeking=true;play(h,0.25);h.audio.seeking=false;},
  ended:h=>{h.audio.ended=true;play(h,0.25);h.audio.ended=false;},
  'low readiness':h=>{h.audio.readyState=2;play(h,0.25);h.audio.readyState=4;},
  'invalid rate':h=>{h.audio.playbackRate=NaN;play(h,0.25);h.audio.playbackRate=1;},
  'long clock gap':h=>{h.clock.now+=2000;},
  'backwards clock':h=>{h.clock.now-=1000;},
  'nonfinite clock':h=>{const now=h.clock.now;h.clock.now=NaN;play(h,0.25);h.clock.now=now+250;},
 };
 for(const [label,interrupt] of Object.entries(breaks)){
  const h=rig();h.player.start(ROOT);retryAfter(h);h.audio.onplaying();play(h,20);interrupt(h);play(h,20);
  assert.equal(retryAfter(h),label==='none'?1000:2000,label);
 }
});

test('Sync reconnect restores the same real-time delay on a shifted timeline only after observed playback',()=>{
 const h=rig();healthy(h);reconnect(h,52000);
 assert.deepEqual(h.types(),['reconnecting']);assert.match(h.events.at(-1),/Reconnecting/);assert.equal(h.player.active,true);
 h.clock.now=54000;update(h,frags(104,{start:500}));
 // P+20 s advanced by 3 s maps to sn 123 at 519 on the new timeline; the old absolute UTC would be 516.
 assert.deepEqual(h.assigned,[519]);assert.deepEqual(h.types(),['reconnecting'],'assignment alone is not success');
 h.audio.onplaying();assert.match(h.events.at(-1),/Returning to your earlier position/);
 h.audio.onseeking();h.clock.now=55000;h.audio.onseeked();
 assert.deepEqual(h.types(),['reconnecting','restored']);assert.match(h.events.at(-1),/near your earlier position.*added delay/);assert.doesNotMatch(h.events.at(-1),/short/);assert.equal(h.pending(10000).length,0);
 h.audio.onplaying();assert.match(h.events.at(-1),/near your earlier position/,'generic playing keeps the recovery guidance');
 // The next qualified playback recaptures the actual position, including the second of loading delay.
 play(h,1);reconnect(h,57000);update(h,frags(105));
 assert.deepEqual(h.assigned,[519,20]);
});
test('the frozen sample survives a failed start and a failure right after issuing restoration',()=>{
 const h=rig();healthy(h);reconnect(h,52000);
 h.setTime(3);play(h,1);
 reconnect(h,55000);
 update(h,frags(105,{start:200}));assert.deepEqual(h.assigned,[219],'incoming audio before restoration did not replace the sample');
 reconnect(h,60000);
 update(h,frags(110));assert.deepEqual(h.assigned,[219,19]);
 h.audio.onseeked();assert.deepEqual(h.types(),['reconnecting','reconnecting','reconnecting','restored']);
});
test('a successful public seek recaptures alignment from the mapped destination, not playingDate',()=>{
 const h=rig();healthy(h);h.clock.now=52000;assert.equal(h.player.seek(25),true);
 reconnect(h,53000);h.clock.now=54000;update(h,frags(104,{start:500}));assert.deepEqual(h.assigned,[25,523]);
});

test('Sync bridges reloads by shared fragment identity, tolerating cc renumbering but not changed, missing or unrelated fragments',()=>{
 const renumbered=restoreWith(frags(104,{start:500,cc:7}));assert.deepEqual(renumbered.assigned,[519]);renumbered.audio.onseeked();assert.equal(renumbered.last().type,'restored');
 const longer=frags(104,{start:500});longer[0].duration=1.3;
 const noSn=frags(104,{start:500});noSn[5].sn=undefined;
 const noCc=frags(104,{start:500});noCc[3].cc=undefined;
 const noPdt=frags(104,{start:500});noPdt[2].programDateTime=null;
 for(const [reason,list] of [['continuity',frags(1004,{pdt:P+4000,start:500})],['identity',frags(104,{pdt:P+4400,start:500})],['identity',longer],['no-timestamps',noSn],['no-timestamps',noCc],['no-timestamps',noPdt]]){
  const h=restoreWith(list);assert.deepEqual(h.assigned,[],reason);assert.equal(h.last().type,'fallback');assert.equal(h.last().reason,reason);
 }
 const split=frags(100);for(const f of split.slice(22))f.cc=1;
 const unrelated=restoreWith(frags(125,{count:11}),{at:57000,old:split});assert.deepEqual(unrelated.assigned,[]);assert.equal(unrelated.last().reason,'continuity');
 const related=restoreWith(frags(125,{count:11}),{at:57000});assert.deepEqual(related.assigned,[1]);
 // sn 104 already proves the bridge; a later shared fragment whose PDT changed must still fail closed.
 const lateMismatch=frags(100);lateMismatch[29].programDateTime+=300;
 const m=restoreWith(frags(104,{start:500}),{old:lateMismatch});assert.deepEqual(m.assigned,[]);assert.equal(m.last().reason,'identity');
});
test('Sync accepts rounded fragment timestamps but rejects real gaps, overlaps and larger shifts',()=>{
 const rounded=restoreWith(frags(104,{start:500,duration:1.001,step:1000}),{old:frags(100,{duration:1.001,step:1000})});
 assert.equal(rounded.assigned.length,1);assert.ok(Math.abs(rounded.assigned[0]-518.999)<1e-6);rounded.audio.onseeked();assert.equal(rounded.last().type,'restored');
 for(const [shift,type] of [[200,'restored'],[300,'fallback'],[2000,'fallback'],[-500,'fallback']]){
  const list=frags(104,{start:500});for(const f of list.slice(27))f.programDateTime+=shift;
  const h=restoreWith(list);h.audio.onseeked();assert.equal(h.last().type,type,`shift ${shift}`);
  if(type==='fallback'){assert.equal(h.last().reason,'continuity');assert.deepEqual(h.assigned,[]);}
 }
 const gap=frags(104,{start:500});for(const f of gap.slice(19))f.programDateTime+=2000;
 const g=restoreWith(gap);assert.deepEqual(g.assigned,[],'a target inside a timestamp gap is never interpolated or clamped');assert.equal(g.last().reason,'unmapped');
});
test('Sync never issues a restoration seek into a media overlap that the UTC lookup alone would accept',()=>{
 // sn 123 starts 200 ms early: within the adjacency tolerance, but media 518.8-519 belongs to sn 122 and sn 123.
 const shifted=()=>{const list=frags(104,{start:500});list[19].start=518.8;return list;};
 const ambiguous=restoreWith(shifted(),{at:53900});
 assert.deepEqual(ambiguous.assigned,[],'P+22.9 s maps uniquely by UTC to 518.9, which two fragments cover');assert.equal(ambiguous.last().reason,'unmapped');
 assert.match(ambiguous.events.at(-1),/could not be verified.*incoming broadcast/);
 const clear=restoreWith(shifted(),{at:54500});assert.equal(clear.assigned.length,1);assert.ok(Math.abs(clear.assigned[0]-519.3)<1e-9,'tolerated adjacency still restores outside the overlap');
 clear.audio.onseeked();assert.equal(clear.last().type,'restored');
});
test('Sync samples and incoming edges require a unique round-trip mapping',()=>{
 // Media 19.75-20 is unique, but sn 120's PDT moved 300 ms early, so those UTCs are also inside sn 119.
 const utcOverlap=frags(100);utcOverlap[20].programDateTime-=300;
 const h=rig();healthy(h,utcOverlap);reconnect(h,52000);h.clock.now=54000;update(h,frags(104,{start:500}));
 assert.deepEqual(h.assigned,[]);assert.equal(h.last().reason,'no-sample');assert.match(h.events.at(-1),/resumes from the incoming broadcast/);
 // sn 132's closed span also reaches the terminal endpoint, so the closed-end edge rule is not unique.
 const sharedEdge=frags(104,{start:500});sharedEdge[28].duration=2;
 const e=restoreWith(sharedEdge);assert.deepEqual(e.assigned,[]);assert.equal(e.last().reason,'invalid-playlist');
 assert.match(e.events.at(-1),/could not be verified/);assert.doesNotMatch(e.events.at(-1),/timestamps/);
 const unordered=frags(104,{start:500});unordered[10].sn=unordered[9].sn;
 const u=restoreWith(unordered);assert.equal(u.last().reason,'invalid-playlist');assert.doesNotMatch(u.events.at(-1),/timestamps/);
});
test('Sync restoration fails closed at the incoming edge, outside the window, on changed edge latency and after the TTL',()=>{
 const inside=restoreWith(frags(104,{start:500}),{end:529.5});assert.deepEqual(inside.assigned,[519],'a clipped endpoint inside the terminal fragment is a valid edge');
 const narrow=restoreWith(frags(104,{start:500}),{begin:525});assert.deepEqual(narrow.assigned,[],'a target in the playlist but outside the seekable range');assert.equal(narrow.last().reason,'unmapped');
 for(const [reason,list,at] of [
  ['unmapped',frags(93)],
  ['unmapped',frags(130)],
  ['edge-latency',frags(104,{start:500,count:40})],
  ['edge-latency',frags(104,{start:500,count:24})],
  ['expired',frags(104,{start:500}),51000+120001],
  ['expired',frags(104,{start:500}),50000],
 ]){
  const h=restoreWith(list,{at});assert.deepEqual(h.assigned,[],reason);assert.equal(h.last().reason,reason);assert.match(h.events.at(-1),/could not be verified/);
 }
});
test('Sync without native HLS timestamps falls back explicitly to manual alignment',()=>{
 const h=rig(true);h.player.start(ROOT);h.audio.onplaying();h.audio.onerror();const [retry]=h.pending();h.fire(retry);
 assert.equal(h.audio.src,ROOT);h.audio.onloadedmetadata();
 assert.equal(h.last().reason,'no-timestamps');assert.match(h.events.at(-1),/does not expose complete broadcast timestamps/);assert.deepEqual(h.assigned,[]);
});
test('a session that never had verified playback reconnects with neutral guidance',()=>{
 const h=rig();h.player.start(ROOT);h.instances[0].error(null,{fatal:true});assert.doesNotMatch(h.events.at(-1),/earlier position/);
 h.fire(h.pending()[0]);update(h,frags(104,{start:500}));
 assert.equal(h.last().reason,'no-sample');assert.match(h.events.at(-1),/resumes from the incoming broadcast/);assert.doesNotMatch(h.events.at(-1),/earlier position/);assert.deepEqual(h.assigned,[]);
});

test('Sync waits for real readiness under one restoration deadline and never reconnects for restoration',()=>{
 const h=rig();healthy(h);const before=h.timers.length;reconnect(h,52000);h.clock.now=54000;h.audio.readyState=0;
 const hls=h.instances.at(-1);hls.emit('levelUpdated');h.audio.onloadedmetadata();assert.deepEqual(h.assigned,[]);
 publish(h,frags(104,{start:500}));hls.emit('levelUpdated');assert.deepEqual(h.assigned,[],'a playlist without media metadata is not ready');
 h.audio.readyState=1;hls.emit('fragBuffered');assert.deepEqual(h.assigned,[519]);
 h.audio.oncanplay();hls.emit('fragBuffered');h.audio.onplaying();assert.deepEqual(h.assigned,[519],'readiness attempts are idempotent');
 assert.equal(h.timers.slice(before).filter(t=>t.ms===10000).length,1);
 const d=rig();healthy(d);reconnect(d,52000);const [deadline]=d.pending(10000);d.audio.readyState=0;update(d,frags(104,{start:500}));
 d.fire(deadline);assert.equal(d.last().reason,'deadline');assert.match(d.events.at(-1),/could not be verified.*incoming broadcast/,'no seek was issued, so audio is at the incoming default');
 d.audio.readyState=4;d.instances.at(-1).emit('fragBuffered');d.audio.onseeked();play(d,1);
 assert.deepEqual(d.assigned,[]);assert.deepEqual(d.types(),['reconnecting','fallback']);assert.equal(d.instances.length,2);assert.equal(d.pending().length,0);
});
test('Sync confirms restoration from observed playback, allows one corrective reissue and falls back at the deadline',()=>{
 const h=restoreWith(frags(104,{start:500}));
 h.setTime(527);h.audio.onseeked();
 assert.deepEqual(h.assigned,[519,519],'HLS moving elsewhere gets one corrective reissue');assert.ok(!h.types().includes('restored'));
 h.setTime(527);h.audio.onseeked();
 assert.deepEqual(h.assigned,[519,519]);assert.equal(h.last().type,'fallback');assert.equal(h.last().reason,'moved');assert.equal(h.pending(10000).length,0);
 assert.equal(h.audio.currentTime,527);assert.match(h.events.at(-1),/could not be confirmed/);assert.doesNotMatch(h.events.at(-1),/incoming/);
 h.audio.onseeked();play(h,1);assert.deepEqual(h.types(),['reconnecting','fallback']);
 const ticked=restoreWith(frags(104,{start:500}));play(ticked,1);assert.equal(ticked.last().type,'restored','qualified progress from the issued position confirms');
 const late=restoreWith(frags(104,{start:500}));late.audio.seeking=true;late.audio.onseeked();late.fire(late.pending(10000)[0]);
 assert.equal(late.audio.currentTime,519,'the issued historical target is still current after the deadline');
 assert.match(late.events.at(-1),/could not be confirmed/);assert.doesNotMatch(late.events.at(-1),/incoming/);
 late.audio.seeking=false;late.audio.onseeked();assert.deepEqual(late.types(),['reconnecting','fallback']);assert.equal(late.last().reason,'deadline');
});
test('Sync user intent wins over restoration: public moves, native control gestures and pause cancel it',()=>{
 const failed=rig();healthy(failed);reconnect(failed,52000);assert.equal(failed.player.seek(-5),false);
 assert.equal(failed.last().type,'canceled');assert.match(failed.events.at(-1),/canceled the return/);assert.equal(failed.pending(10000).length,0);
 failed.clock.now=54000;update(failed,frags(104,{start:500}));assert.deepEqual(failed.assigned,[]);
 const moved=restoreWith(frags(104,{start:500}));assert.equal(moved.player.live(),true);assert.deepEqual(moved.assigned,[519,527]);assert.equal(moved.last().type,'canceled');
 moved.audio.onseeked();play(moved,1);assert.deepEqual(moved.types(),['reconnecting','canceled']);
 const gestures=[['pointer',a=>a.onpointerdown({})],['pause',a=>{a.paused=true;a.onpause();}],...CONTROL_KEYS.map(key=>[`key ${JSON.stringify(key)}`,a=>a.onkeydown({key})])];
 for(const [label,gesture] of gestures){
  const g=rig();healthy(g);reconnect(g,52000);gesture(g.audio);g.audio.paused=false;g.clock.now=54000;update(g,frags(104,{start:500}));
  assert.deepEqual(g.assigned,[],`pending: ${label}`);assert.deepEqual(g.types(),['reconnecting','canceled'],`pending: ${label}`);
  const issued=restoreWith(frags(104,{start:500}));gesture(issued.audio);issued.audio.paused=false;issued.audio.onseeked();play(issued,1);
  assert.deepEqual(issued.assigned,[519],`issued: ${label}`);assert.deepEqual(issued.types(),['reconnecting','canceled'],`issued: ${label}`);
 }
 const ignored=rig();healthy(ignored);reconnect(ignored,52000);ignored.audio.onkeydown({key:'a'});ignored.audio.onseeking();
 ignored.clock.now=54000;update(ignored,frags(104,{start:500}));assert.deepEqual(ignored.assigned,[519],'other keys and native seeking alone do not cancel');
 const backoff=rig();healthy(backoff);backoff.instances[0].error(null,{fatal:true});assert.equal(backoff.player.seek(25),false);
 const [retry]=backoff.pending();backoff.clock.now=53000;backoff.fire(retry);backoff.clock.now=54000;update(backoff,frags(104,{start:500}));
 assert.deepEqual(backoff.assigned,[]);assert.deepEqual(backoff.types(),['reconnecting','canceled']);
});
test('native control gestures during retry backoff cancel the retained restoration; teardown pause cannot',()=>{
 for(const [label,gesture] of [['pointer',a=>a.onpointerdown({})],...CONTROL_KEYS.map(key=>[`key ${JSON.stringify(key)}`,a=>a.onkeydown({key})])]){
  const h=rig();healthy(h);h.instances[0].error(null,{fatal:true});
  assert.equal(h.audio.onpause,null,'private teardown removes the pause handler before its own pause()');
  assert.deepEqual(h.types(),['reconnecting'],'teardown alone does not cancel');
  gesture(h.audio);assert.deepEqual(h.types(),['reconnecting','canceled'],label);
  h.clock.now=53000;h.fire(h.pending()[0]);h.clock.now=54000;update(h,frags(104,{start:500}));
  assert.deepEqual(h.assigned,[],label);
 }
 const ignored=rig();healthy(ignored);ignored.instances[0].error(null,{fatal:true});ignored.audio.onkeydown({key:'a'});
 ignored.clock.now=53000;ignored.fire(ignored.pending()[0]);ignored.clock.now=54000;update(ignored,frags(104,{start:500}));assert.deepEqual(ignored.assigned,[519]);
});
test('a later intentional playback change clears a completed recovery notice',()=>{
 const h=restoreWith(frags(104,{start:500}));h.audio.onseeked();h.audio.onplaying();assert.match(h.events.at(-1),/Returned near your earlier position/);
 h.audio.onpointerdown({});h.audio.onplaying();assert.equal(h.events.at(-1),'Playing. Check alignment with your TV.');
 const c=restoreWith(frags(104,{start:500}));c.player.seek(510);c.audio.onplaying();assert.match(c.events.at(-1),/canceled the return/);
 c.player.seek(512);c.audio.onplaying();assert.equal(c.events.at(-1),'Playing. Check alignment with your TV.');
});
test('Jump to incoming cancels restoration once and the canceled notice survives the next generic playing',()=>{
 const pending=rig();healthy(pending);reconnect(pending,52000);pending.clock.now=54000;publish(pending,frags(104,{start:500}));
 assert.equal(pending.player.live(),true);assert.deepEqual(pending.assigned,[527]);
 pending.audio.onplaying();assert.match(pending.events.at(-1),/canceled the return/);assert.deepEqual(pending.types(),['reconnecting','canceled']);
 const issued=restoreWith(frags(104,{start:500}));assert.equal(issued.player.live(),true);assert.deepEqual(issued.assigned,[519,527]);
 issued.audio.onplaying();assert.match(issued.events.at(-1),/canceled the return/);
 const empty=rig();healthy(empty);reconnect(empty,52000);assert.equal(empty.player.live(),false,'no seekable window yet');
 assert.deepEqual(empty.types(),['reconnecting','canceled']);empty.audio.onplaying();assert.match(empty.events.at(-1),/canceled the return/);
 empty.clock.now=54000;update(empty,frags(104,{start:500}));assert.deepEqual(empty.assigned,[]);
});
test('a stale queued pause after a source switch is ignored while the new audio is playing',()=>{
 const h=rig();healthy(h);h.player.start('https://gateway.example/media/game/team/two');
 const count=h.events.length;h.audio.paused=false;h.audio.onpause();assert.equal(h.events.length,count,'no Audio paused status');
 h.instances.at(-1).error(null,{fatal:true});assert.equal(h.pending()[0]?.ms,1000,'a later fatal error still retries');assert.equal(h.player.active,true);
});
test('a recovery callback that stops or replaces the player cannot break the current tick',()=>{
 for(const action of [h=>h.player.stop(),h=>h.player.start('https://gateway.example/media/game/team/two')]){
  const h=rig();h.player.start(ROOT);h.instances[0].error(null,{fatal:true});h.fire(h.pending()[0]);
  h.hooks.recovery=e=>{if(e.type==='fallback')action(h);};
  const tick=h.audio.ontimeupdate;h.clock.now+=250;assert.doesNotThrow(tick);assert.equal(h.last().reason,'no-sample');
 }
});
test('Sync stop and source replacement cancel recovery timers, handlers and stale callbacks',()=>{
 const h=rig();healthy(h);reconnect(h,52000);
 const hls=h.instances.at(-1),seeked=h.audio.onseeked,timeupdate=h.audio.ontimeupdate,[deadline]=h.pending(10000);
 h.player.stop();assert.equal(h.player.active,false);assert.equal(deadline.cleared,true);
 for(const name of ['onplaying','onwaiting','onstalled','onpause','onerror','onended','ontimeupdate','onseeking','onseeked','onloadedmetadata','oncanplay','onpointerdown','onkeydown'])assert.equal(h.audio[name],null,name);
 const seen=[h.events.length,h.recoveries.length];publish(h,frags(104,{start:500}));hls.emit('levelUpdated');hls.error(null,{fatal:true});seeked();timeupdate();deadline.fn();
 assert.deepEqual([h.events.length,h.recoveries.length],seen);assert.deepEqual(h.assigned,[]);assert.equal(h.pending().length,0);
 const b=rig();healthy(b);b.instances[0].error(null,{fatal:true});const [retry]=b.pending();
 assert.equal(b.player.active,true,'Stop stays usable while recovery is retained');b.player.stop();assert.equal(retry.cleared,true);retry.fn();assert.equal(b.instances.length,1);
 const s=rig();healthy(s);reconnect(s,52000);const staleHls=s.instances.at(-1),staleDown=s.audio.onpointerdown,[stale]=s.pending(10000),seenS=s.recoveries.length;
 s.player.start('https://gateway.example/media/game/team/two');assert.equal(stale.cleared,true);assert.notEqual(s.audio.onpointerdown,staleDown);
 stale.fn();staleHls.emit('levelUpdated');staleHls.error(null,{fatal:true});staleDown({});assert.equal(s.recoveries.length,seenS);
 update(s,frags(104,{start:500}));assert.deepEqual(s.assigned,[],'a new source never restores the old session');assert.equal(s.instances.at(-1).url,'https://gateway.example/media/game/team/two');
});
