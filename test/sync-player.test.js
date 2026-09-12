import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function harness(native=false){
 const instances=[],events=[];const audio={currentTime:10,seekable:{length:1,start:()=>0,end:()=>40},play:()=>Promise.resolve(),pause(){},removeAttribute(){},load(){},canPlayType:()=> 'maybe'};
 class Hls {static isSupported(){return !native}static Events={ERROR:'error'};constructor(){instances.push(this);this.playingDate=new Date(100000);this.latestLevelDetails={fragments:[{start:15}],edge:35}}on(e,f){this.error=f}loadSource(u){this.url=u}attachMedia(a){this.audio=a}destroy(){this.destroyed=true}}
 const context=vm.createContext({Hls});vm.runInContext(fs.readFileSync(new URL('../src/sync-player.js',import.meta.url),'utf8').replace(/^import .*;\n/,'').replace('export class','class')+';globalThis.SyncPlayer=SyncPlayer;',context);
 const player=new context.SyncPlayer(audio,s=>events.push(s));return{player,audio,instances,events};
}
test('Sync bounds restrict seeks to the current playlist; stop unloads media and ignores old callbacks',()=>{
 const h=harness();h.player.start('https://example.cloudfront.net/live.m3u8');const old=h.audio.onplaying;
 assert.equal(h.player.timing().utc,100000);assert.equal(h.player.seek(10),false);assert.equal(h.player.seek(20),true);assert.equal(h.audio.currentTime,20);
 assert.equal(h.player.live(),true);assert.equal(h.audio.currentTime,32);h.player.stop();const count=h.events.length;old();assert.equal(h.events.length,count);assert.ok(h.instances[0].destroyed);
});
test('native HLS never invents real-time timestamps',()=>{const h=harness(true);h.player.start('https://example.cloudfront.net/live.m3u8');assert.equal(h.player.timing().utc,undefined);assert.equal(h.audio.src,'https://example.cloudfront.net/live.m3u8');h.player.stop()});
