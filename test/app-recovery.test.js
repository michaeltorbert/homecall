import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { PlaybackMemory } from '../src/playback-memory.js';
import { SessionLog } from '../src/session-log.js';
import { teams, getSources } from '../src/teams.js';
globalThis.__GATEWAY_ORIGIN__='https://gateway.example';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const settle=()=>new Promise(r=>setImmediate(r));
function harness(t, catalogFactory) {
 const dom=new JSDOM(html,{url:'https://example.test/',runScripts:'outside-only'}),w=dom.window;
 t.after(()=>w.close());let player, catalog;
 class FakePlayer {
  constructor(update,event){this.update=update;this.event=event;this.sequence=0;this.epoch=0;player=this;this.starts=[];}
  start(url,delay){this.starts.push({url,delay});this.context={state:'running'};this.audio={paused:false};if(this.failNext){this.failNext=false;return Promise.reject(Error('source-error'))}return Promise.resolve();}
  stop(){this.context=null;this.audio=null;}
  command(type,value){this.lastCommand={type,value};return Promise.resolve({result:'applied',before:{delay:35},after:{delay:35},contextSeconds:1});}
  resumeContext(){return Promise.resolve();}
 }
 Object.assign(w,{setupSync:()=>({}),setupHomestream:callbacks=>(catalog=catalogFactory ? catalogFactory(callbacks) : {ready:null,stop(){},setEnabled(){}}),PlaybackMemory,SessionLog,teams,getSources,Player:FakePlayer,demoURL:()=> 'blob:demo',setupArchive:()=>{}});
 w.localStorage.setItem('homecall.position.live.duke-leanstream',JSON.stringify({version:1,value:35,savedAt:Date.now()-20000}));
 w.URL.revokeObjectURL=()=>{};w.eval(source);return {w,player,get catalog(){return catalog},$:id=>w.document.getElementById(id)};
}
test('reconnect and reload restore the saved source delay without replacing it with refill state',async t=>{
 const h=harness(t);h.$('connect').click();await settle();assert.equal(h.player.starts[0].delay,35);
 h.player.update({delay:0,available:0,paused:true,holding:false,ingesting:true,restoring:35});
 h.player.update({delay:10,available:10,paused:true,holding:false,ingesting:true,restoring:35});
 assert.equal(JSON.parse(h.w.localStorage.getItem('homecall.position.live.duke-leanstream')).value,35);
 assert.match(h.$('status').textContent,/25 s of audio/);
 h.$('connect').click();await settle();assert.equal(h.player.starts[1].delay,35);
 h.player.update({delay:35,available:40,paused:false,holding:false,ingesting:true,restoring:null});
 h.player.update({delay:37,available:45,paused:false,holding:false,ingesting:true,restoring:null});
 h.$('connect').click();await settle();assert.equal(h.player.starts[2].delay,37);
});
test('source changes and demo cannot inherit or overwrite another live source delay',async t=>{
 const h=harness(t);h.$('demo').click();await settle();assert.equal(h.player.starts[0].delay,0);
 h.player.update({delay:5,available:10,paused:false,holding:false,ingesting:true,restoring:null});
 assert.equal(JSON.parse(h.w.localStorage.getItem('homecall.position.live.duke-leanstream')).value,35);
 h.$('team').value='miami';h.$('team').onchange();h.$('connect').click();await settle();assert.equal(h.player.starts[1].delay,0);
});
test('pause offers saved-delay default and retained-position alternative',async t=>{
 const h=harness(t);h.$('connect').click();await settle();
 h.player.update({delay:55,available:90,paused:true,holding:false,ingesting:true,restoring:null});
 assert.equal(h.$('resume-position').hidden,false);
 h.$('pause').click();await settle();assert.deepEqual(h.player.lastCommand,{type:'restore',value:35});
 h.$('resume-position').click();await settle();assert.deepEqual(h.player.lastCommand,{type:'pause',value:false});
});

test('the Pause action does not reconnect when audio has already recovered from a native pause',async t=>{
 const h=harness(t);h.$('connect').click();await settle();h.player.event('source-paused');h.player.event('source-playing');
 h.player.update({delay:35,resumeDelay:35,available:90,paused:false,holding:false,ingesting:true,restoring:null});
 h.$('pause').click();await settle();assert.equal(h.player.starts.length,1);assert.deepEqual(h.player.lastCommand,{type:'pause',value:true});
});
test('a drained live buffer preserves its reconnect delay preference',async t=>{
 const h=harness(t);h.$('connect').click();await settle();
 h.player.update({delay:33,resumeDelay:35,available:90,paused:false,holding:false,ingesting:true,restoring:null});
 h.$('connect').click();await settle();assert.equal(h.player.starts.at(-1).delay,35);
});

test('demo Resume uses its in-session delay while leaving live preferences untouched',async t=>{
 const h=harness(t);h.$('demo').click();await settle();
 h.player.update({delay:5,available:20,paused:false,holding:false,ingesting:true,restoring:null});
 h.player.update({delay:8,available:25,paused:true,holding:false,ingesting:true,restoring:null});
 h.$('pause').click();await settle();assert.deepEqual(h.player.lastCommand,{type:'restore',value:5});
 assert.equal(JSON.parse(h.w.localStorage.getItem('homecall.position.live.duke-leanstream')).value,35);
});

test('recovered native pause does not force a later manual Resume to reconnect',async t=>{
 const h=harness(t);h.$('connect').click();await settle();h.player.event('source-paused');h.player.event('source-playing');
 h.player.update({delay:35,available:90,paused:false,holding:false,ingesting:true,restoring:null});
 h.$('pause').click();await settle();h.player.update({delay:40,available:95,paused:true,holding:false,ingesting:true,restoring:null});
 h.$('pause').click();await settle();assert.equal(h.player.starts.length,1);assert.deepEqual(h.player.lastCommand,{type:'restore',value:35});
});

test('a stale playing snapshot cannot erase a native pause awaiting recovery',async t=>{
 const h=harness(t);h.$('connect').click();await settle();h.player.audio.paused=true;h.player.event('source-paused');
 h.player.update({delay:35,available:90,paused:false,holding:false,ingesting:true,restoring:null});
 h.player.update({delay:35,available:90,paused:true,holding:false,ingesting:false,restoring:null});
 h.player.audio.paused=false;h.$('pause').click();await settle();assert.equal(h.player.starts.length,2);
});

test('failed GT startup refreshes catalog before retry and refuses a withdrawn feed',async t=>{
 const first={id:'game-one',url:'https://gateway.example/media/game/team/game-one',opponent:'Tennessee'};
 const next={...first,url:'https://gateway.example/media/game/team/game-two'};
 let refreshed=0;
 const h=harness(t,callbacks=>({ready:first,stop(){},setEnabled(){},async refresh(){this.ready=null;callbacks.onChange();this.ready=++refreshed===1?next:null;callbacks.onReady()}}));
 h.$('team').value='gt';h.$('team').onchange();h.player.failNext=true;h.$('connect').click();await settle();
 assert.equal(refreshed,1);assert.equal(h.catalog.ready.url,next.url);assert.equal(h.$('connect').disabled,false);
 h.player.failNext=true;h.$('connect').click();await settle();assert.equal(h.player.starts[1].url,next.url);assert.equal(refreshed,2);assert.equal(h.$('connect').disabled,true);
});
test('GT reconnect refreshes before Play and delay memory belongs to the selected game',async t=>{
 const game={id:'game-one',url:'https://gateway.example/media/game/team/game-one',opponent:'Tennessee'};let refreshed=0;
 const h=harness(t,callbacks=>({ready:game,stop(){},setEnabled(){},async refresh(){refreshed++;callbacks.onChange();callbacks.onReady()}}));
 h.$('team').value='gt';h.$('team').onchange();h.$('connect').click();await settle();assert.equal(h.player.starts[0].delay,0);
 h.player.update({delay:7,resumeDelay:7,available:10,paused:false,ingesting:true,holding:false,restoring:null});
 h.$('connect').click();await settle();assert.equal(refreshed,1);assert.equal(h.player.starts.length,1);
 h.$('connect').click();await settle();assert.equal(h.player.starts[1].delay,7);
 h.$('stop').click();h.catalog.ready={...game,id:'game-two'};h.$('connect').click();await settle();assert.equal(h.player.starts[2].delay,0);
});
test('choosing a backup stops playback, resets delay and logs the actual source',async t=>{
 const h=harness(t);h.$('connect').click();await settle();
 h.player.update({delay:35,available:40,paused:false,holding:false,ingesting:true,restoring:null});
 h.$('feed').value='duke-varsity';h.$('feed').onchange();
 assert.equal(h.player.audio,null);assert.equal(h.$('pause').disabled,true);
 assert.equal(h.$('delay').textContent,'0.00');assert.match(h.$('notice').textContent,/Press Play/);
 assert.match(h.$('official').href,/thevarsitynetwork/);
 h.$('connect').click();await settle();
 assert.equal(h.player.starts.at(-1).url,'https://gateway.example/media/live/duke-varsity');
 assert.equal(h.player.starts.at(-1).delay,0);
 h.$('preview').click();assert.equal(JSON.parse(h.$('export').value).sourceId,'duke-varsity');
 h.player.update({delay:7,available:20,paused:false,holding:false,ingesting:true,restoring:null});
 h.$('connect').click();await settle();assert.equal(h.player.starts.at(-1).delay,7);
 assert.equal(JSON.parse(h.w.localStorage.getItem('homecall.position.live.duke-leanstream')).value,35);
});
test('returning to a previously delayed source starts fresh after an explicit source switch',async t=>{
 const h=harness(t);
 h.$('feed').value='duke-wsjs';h.$('feed').onchange();h.$('connect').click();await settle();
 h.$('feed').value='duke-leanstream';h.$('feed').onchange();
 h.$('connect').click();await settle();assert.equal(h.player.starts.at(-1).delay,0);
 assert.equal(JSON.parse(h.w.localStorage.getItem('homecall.position.live.duke-leanstream')).value,0);
});
test('a pending connection cannot overwrite the state of a newly selected affiliate',async t=>{
 const h=harness(t);let reject;
 h.player.start=()=>new Promise((_,r)=>{reject=r;});
 h.$('connect').click();assert.equal(h.$('connect').disabled,true);
 h.$('feed').value='duke-wccg';h.$('feed').onchange();
 reject(Error('old source failed'));await settle();
 assert.equal(h.$('connect').disabled,false);assert.match(h.$('notice').textContent,/Ready for WCCG/);
 assert.equal(h.$('status').textContent,'Disconnected');
 assert.match(h.$('official').href,/WCCG/);
});
test('failure suggests backups without silently switching stations; retries keep fresh-source delay',async t=>{
 const h=harness(t);let fail=true;
 const start=h.player.start.bind(h.player);
 h.player.start=(url,delay)=>{const result=start(url,delay);return fail?Promise.reject(Error('network')):result;};
 h.w.localStorage.setItem('homecall.position.live.duke-wtib',JSON.stringify({version:1,value:20,savedAt:Date.now()}));
 h.$('feed').value='duke-wtib';h.$('feed').onchange();h.$('connect').click();await settle();
 assert.match(h.$('notice').textContent,/choose another Audio feed/);
 assert.equal(h.$('feed').value,'duke-wtib');assert.equal(h.player.starts.length,1);
 fail=false;h.$('connect').click();await settle();assert.equal(h.player.starts.at(-1).delay,0);
 h.$('preview').click();assert.equal(JSON.parse(h.$('export').value).sourceId,'duke-wtib');
});
test('backup controls and official links reset when changing teams',async t=>{
 const h=harness(t);assert.equal(h.$('feed-picker').hidden,false);assert.equal(h.$('feed').options.length,5);
 h.$('feed').value='duke-wccg';h.$('feed').onchange();
 h.$('team').value='miami';h.$('team').onchange();assert.equal(h.$('feed-picker').hidden,true);
 h.$('connect').click();await settle();assert.equal(h.player.starts.at(-1).url,teams.miami.url);
 assert.equal(h.$('official').href,teams.miami.official);
 h.$('team').value='duke';h.$('team').onchange();assert.equal(h.$('feed').value,'duke-leanstream');
});

test('fixed relay playback starts synchronously within the click gesture', t => {
 const h=harness(t);h.$('connect').click();
 assert.equal(h.player.starts.length,1);
 assert.equal(h.player.starts[0].url,'https://gateway.example/media/live/duke-leanstream');
});
