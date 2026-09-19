import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function harness(native=false,timing={}){
 const instances=[],events=[];const audio={currentTime:10,seekable:{length:1,start:()=>0,end:()=>40},play:()=>Promise.resolve(),pause(){},removeAttribute(){},load(){},canPlayType:()=> 'maybe'};
 class Hls {static isSupported(){return !native}static Events={ERROR:'error'};constructor(){instances.push(this);this.playingDate=new Date(100000);this.latestLevelDetails={fragments:[{start:15}],edge:35}}on(e,f){this.error=f}loadSource(u){this.url=u}attachMedia(a){this.audio=a}destroy(){this.destroyed=true}}
 const context=vm.createContext({Hls,setTimeout:timing.setTimeout||setTimeout,clearTimeout:timing.clearTimeout||clearTimeout});vm.runInContext(fs.readFileSync(new URL('../src/sync-player.js',import.meta.url),'utf8').replace(/^import .*;\n/,'').replace('export class','class')+';globalThis.SyncPlayer=SyncPlayer;',context);
 const player=new context.SyncPlayer(audio,s=>events.push(s));return{player,audio,instances,events};
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
 const paused=retryHarness();paused.player.start('https://gateway.example/media/game/team/one');paused.audio.onpause();paused.instances[0].error(null,{fatal:true});assert.equal(paused.next(),undefined);assert.match(paused.events.at(-1),/press Play/);
});

test('Sync post-start buffering watchdog is bounded and canceled by playback, pause and stop',()=>{
 const h=retryHarness();h.player.start('https://gateway.example/media/game/team/one');h.audio.onwaiting();assert.equal(h.timers.filter(t=>!t.cleared&&t.ms===20000).length,1);
 h.audio.onplaying();h.audio.onwaiting();const timer=h.timers.find(t=>!t.cleared&&t.ms===20000);h.audio.onwaiting();assert.equal(h.timers.filter(t=>!t.cleared&&t.ms===20000).length,1);
 h.audio.onplaying();assert.equal(timer.cleared,true);
 h.audio.onwaiting();const paused=h.timers.find(t=>!t.cleared&&t.ms===20000);h.audio.onpause();assert.equal(paused.cleared,true);
 h.audio.onplaying();h.audio.readyState=2;h.audio.onstalled();h.timers.find(t=>!t.cleared&&t.ms===20000).fn();assert.equal(h.next().ms,1000);h.player.stop();assert.equal(h.next(),undefined);
});
