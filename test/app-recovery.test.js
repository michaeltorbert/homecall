import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { PlaybackMemory } from '../src/playback-memory.js';
import { SessionLog } from '../src/session-log.js';
import { teams, getSources } from '../src/teams.js';
import { createNowPlaying, nowPlayingArtwork } from '../src/now-playing.js';
import { createScoreboard } from '../src/scoreboard.js';
import { metadataURL, configuredGatewayOrigin, gatewayOptions } from '../src/gateway.js';
import * as shell from '../src/ui-shell.js';
globalThis.__GATEWAY_ORIGIN__='https://gateway.example';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const settle=()=>new Promise(r=>setImmediate(r));
function harness(t, catalogFactory, extra={}) {
 const dom=new JSDOM(html,{url:'https://example.test/',runScripts:'outside-only'}),w=dom.window;
 t.after(()=>w.close());let player, catalog;
 class FakePlayer {
  constructor(update,event){this.update=update;this.event=event;this.sequence=0;this.epoch=0;player=this;this.starts=[];}
  start(url,delay){this.starts.push({url,delay});this.context={state:'running'};this.audio={paused:false};if(this.failNext){this.failNext=false;return Promise.reject(Error('source-error'))}return Promise.resolve();}
  stop(){this.context=null;this.audio=null;}
  command(type,value){this.lastCommand={type,value};return Promise.resolve({result:'applied',before:{delay:35},after:{delay:35},contextSeconds:1});}
  resumeContext(){return Promise.resolve();}
 }
 Object.assign(w,{setupSync:()=>({}),setupHomestream:callbacks=>(catalog=catalogFactory ? catalogFactory(callbacks) : {ready:null,stop(){},setEnabled(){}}),PlaybackMemory,SessionLog,teams,getSources,Player:FakePlayer,demoURL:()=> 'blob:demo',setupArchive:()=>{},
  createNowPlaying,nowPlayingArtwork,createScoreboard,metadataURL,configuredGatewayOrigin,gatewayOptions,readJSON:async()=>{throw Error('no metadata in recovery tests');},...shell,...extra});
 w.localStorage.setItem('homecall.position.live.duke-leanstream',JSON.stringify({version:1,value:35,savedAt:Date.now()-20000}));
 w.URL.revokeObjectURL=()=>{};w.eval(source);const $=id=>w.document.getElementById(id);
 return {w,player,get catalog(){return catalog},$,prompt:()=>$('confirm-dialog').hasAttribute('open'),proceed:()=>$('confirm-continue').click(),dismiss:()=>$('confirm-cancel').click()};
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
 h.$('team').value='miami';h.$('team').onchange();h.proceed();h.$('connect').click();await settle();assert.equal(h.player.starts[1].delay,0);
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
 h.$('connect').click();assert.equal(h.prompt(),true,'reconnecting a game asks before its catalog refresh stops audio');
 h.proceed();await settle();assert.equal(refreshed,1);assert.equal(h.player.starts.length,1);
 h.$('connect').click();await settle();assert.equal(h.player.starts[1].delay,7);
 h.$('stop').click();h.catalog.ready={...game,id:'game-two'};h.$('connect').click();await settle();assert.equal(h.player.starts[2].delay,0);
});
test('choosing a backup stops playback, resets delay and logs the actual source',async t=>{
 const h=harness(t);h.$('connect').click();await settle();
 h.player.update({delay:35,available:40,paused:false,holding:false,ingesting:true,restoring:null});
 h.$('feed').value='duke-varsity';h.$('feed').onchange();h.proceed();
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
 h.$('feed').value='duke-leanstream';h.$('feed').onchange();h.proceed();
 h.$('connect').click();await settle();assert.equal(h.player.starts.at(-1).delay,0);
 assert.equal(JSON.parse(h.w.localStorage.getItem('homecall.position.live.duke-leanstream')).value,0);
});
test('a pending connection cannot overwrite the state of a newly selected affiliate',async t=>{
 const h=harness(t);let reject;
 h.player.start=()=>new Promise((_,r)=>{reject=r;});
 h.$('connect').click();assert.equal(h.$('connect').disabled,true);
 h.$('feed').value='duke-wccg';h.$('feed').onchange();h.proceed();
 reject(Error('old source failed'));await settle();
 assert.equal(h.$('connect').disabled,false);assert.match(h.$('notice').textContent,/Ready for WCCG/);
 assert.equal(h.$('status').textContent,'Stopped');
 assert.match(h.$('official').href,/WCCG/);
});
test('failure suggests backups without silently switching stations; retries keep fresh-source delay',async t=>{
 const h=harness(t);let fail=true;
 const start=h.player.start.bind(h.player);
 h.player.start=(url,delay)=>{const result=start(url,delay);return fail?Promise.reject(Error('network')):result;};
 h.w.localStorage.setItem('homecall.position.live.duke-wtib',JSON.stringify({version:1,value:20,savedAt:Date.now()}));
 h.$('feed').value='duke-wtib';h.$('feed').onchange();h.$('connect').click();await settle();
 assert.match(h.$('notice').textContent,/choose another source/);
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
 h.$('team').value='duke';h.$('team').onchange();h.proceed();assert.equal(h.$('feed').value,'duke-leanstream');
});

test('fixed relay playback starts synchronously within the click gesture', t => {
 const h=harness(t);h.$('connect').click();
 assert.equal(h.player.starts.length,1);
 assert.equal(h.player.starts[0].url,'https://gateway.example/media/live/duke-leanstream');
});

// ---------- Compact shell: confirmations, primary state and the browsing owner strip ----------
const PLAYING={delay:35,available:90,paused:false,holding:false,ingesting:true,restoring:null};
const stored=h=>h.w.localStorage.getItem('homecall.position.live.duke-leanstream');
test('Cancel on team and source prompts leaves audio, buffer, log, stored delay and the committed choice untouched',async t=>{
 const h=harness(t);h.$('connect').click();await settle();h.player.update(PLAYING);
 const before={audio:h.player.audio,starts:h.player.starts.length,delay:stored(h),sessions:h.w.localStorage.length,status:h.$('status').textContent};
 h.$('team').value='miami';h.$('team').onchange();
 assert.equal(h.prompt(),true);assert.equal(h.$('team').value,'duke','the select keeps the committed team while asking');
 assert.equal(h.player.audio,before.audio,'nothing stops before Continue');
 h.dismiss();assert.equal(h.prompt(),false);
 h.$('feed').value='duke-wsjs';h.$('feed').onchange();assert.equal(h.$('feed').value,'duke-leanstream');
 h.$('confirm-dialog').dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(h.prompt(),false,'Escape is Cancel');
 assert.deepEqual({audio:h.player.audio,starts:h.player.starts.length,delay:stored(h),sessions:h.w.localStorage.length,status:h.$('status').textContent},before);
 assert.equal(h.$('team').value,'duke');assert.equal(h.$('feed').value,'duke-leanstream');assert.match(h.$('official').href,/leanplayer/);
 h.$('preview').click();assert.equal(JSON.parse(h.$('export').value).status,'active-snapshot','the log session stays open');
});
test('Continue applies the original change synchronously inside its own click',async t=>{
 const h=harness(t);h.$('connect').click();await settle();h.player.update(PLAYING);
 h.$('team').value='miami';h.$('team').onchange();h.proceed();
 assert.equal(h.player.audio,null);assert.equal(h.$('team').value,'miami');assert.equal(h.$('status').textContent,'Stopped');
 h.$('connect').click();assert.equal(h.player.starts.at(-1).url,teams.miami.url,'Play still starts inside the click');
});
test('a terminal error or a newer prompt invalidates a pending change; a stale Continue does nothing',async t=>{
 const h=harness(t);h.$('connect').click();await settle();h.player.update(PLAYING);
 h.$('feed').value='duke-wsjs';h.$('feed').onchange();assert.equal(h.prompt(),true);
 h.player.event('source-reconnect-exhausted');assert.equal(h.prompt(),false,'terminal failure closes the prompt as Cancel');
 h.proceed();assert.equal(h.$('feed').value,'duke-leanstream');assert.match(h.$('official').href,/leanplayer/);assert.equal(h.player.starts.length,1);
 h.player.event('source-reconnected');
 h.$('team').value='vt';h.$('team').onchange();h.$('feed').value='duke-wccg';h.$('feed').onchange();
 h.proceed();assert.equal(h.$('team').value,'duke','the superseded team prompt was canceled');assert.match(h.$('official').href,/WCCG/);
});
test('GT reconnect Cancel keeps the broadcast and never refreshes its catalog',async t=>{
 const game={id:'game-one',url:'https://gateway.example/media/game/team/game-one',opponent:'Tennessee'};let refreshed=0;
 const h=harness(t,callbacks=>({ready:game,stop(){},setEnabled(){},async refresh(){refreshed++;callbacks.onChange();callbacks.onReady()}}));
 h.$('team').value='gt';h.$('team').onchange();h.$('connect').click();await settle();h.player.update(PLAYING);
 h.$('menu-reconnect').click();assert.equal(h.prompt(),true);h.dismiss();await settle();
 assert.equal(refreshed,0);assert.notEqual(h.player.audio,null);assert.equal(h.player.starts.length,1);
});
test('primary state follows actual output: restoring, connecting, interruption, hold, pause, playing and neutral Stopped',async t=>{
 const h=harness(t);assert.equal(h.$('status').textContent,'Stopped');assert.equal(h.$('connect').hidden,false);assert.equal(h.$('pause').hidden,true);
 h.$('connect').click();assert.equal(h.$('status').textContent,'Connecting…');await settle();
 h.player.update({...PLAYING,restoring:35,available:10});assert.match(h.$('status').textContent,/^Restoring 35\.0-second delay/);
 h.player.update(PLAYING);assert.equal(h.$('status').textContent,'Playing');assert.equal(h.$('connect').hidden,true);assert.equal(h.$('pause').textContent,'Pause');
 h.player.event('source-waiting');h.player.update({...PLAYING,ingesting:false});assert.equal(h.$('status').textContent,'Playing · check playback','input buffering alone is not a stop');
 h.player.event('source-playing');h.player.update({...PLAYING,holding:true});assert.equal(h.$('status').textContent,'Paused for TV');assert.equal(h.$('pause').textContent,'Paused');
 h.player.update({...PLAYING,paused:true});assert.equal(h.$('status').textContent,'Paused');assert.equal(h.$('pause').textContent,'Resume');
 h.player.context.state='suspended';h.player.event('context-interrupted');assert.equal(h.$('status').textContent,'Interrupted');
 h.player.event('source-reconnect-required');h.player.update(null);
 assert.equal(h.$('status').textContent,'Disconnected','a terminal error is not neutral idle');assert.match(h.$('notice').textContent,/Press Play to reconnect/);
 assert.equal(h.$('connect').hidden,false);assert.equal(h.$('recovery-actions').hidden,false);
 assert.equal(h.$('stop').disabled,true,'nothing is left to stop, so the terminal error is not dismissed by Stop');
 h.$('stop').click();assert.equal(h.$('status').textContent,'Disconnected');assert.match(h.$('notice').textContent,/Press Play to reconnect/);
});
test('Playing requires an actual audio element and context; buffered output without ingestion still counts',async t=>{
 const h=harness(t);h.$('connect').click();await settle();h.player.update(PLAYING);assert.equal(h.$('status').textContent,'Playing');
 const audio=h.player.audio;h.player.audio=null;h.player.update(PLAYING);assert.equal(h.$('status').textContent,'Check playback','missing output element is never Playing');
 h.player.audio=audio;const context=h.player.context;h.player.context=null;h.player.update(PLAYING);assert.equal(h.$('status').textContent,'Check playback');
 h.player.context=context;h.player.update({...PLAYING,ingesting:false});assert.equal(h.$('status').textContent,'Playing');
});
test('the main screen carries no generic idle or start advice; real results and the hold instruction stay where they belong',async t=>{
 const h=harness(t);assert.equal(h.$('notice').textContent,'');
 h.$('connect').click();assert.equal(h.$('notice').textContent,'');await settle();
 h.player.update({...PLAYING,restoring:35,available:10});assert.match(h.$('notice').textContent,/^Restoring your saved 35\.0-second delay/,'saved-delay restoration stays visible');
 h.player.update(PLAYING);h.$('hold').click();await settle();h.player.update({...PLAYING,holding:true});
 assert.equal(h.$('notice').textContent,'','the hold instruction appears only in Match my TV');assert.match(h.$('sync-help').textContent,/When the TV reaches/);
 h.$('stop').click();assert.equal(h.$('notice').textContent,'');
});
test('radio sources show concise labels while keeping every source ID and its full description',async t=>{
 const h=harness(t);const options=[...h.$('feed').options];
 assert.deepEqual(options.map(o=>o.textContent),['Network','Network backup','WSJS backup','WCCG backup','WTIB backup']);
 assert.deepEqual(options.map(o=>o.value),getSources('duke').map(s=>s.sourceId));
 assert.deepEqual(options.map(o=>o.title),getSources('duke').map(s=>s.label));
 assert.equal(h.$('station').textContent,'Duke Sports Network');
});
test('hold opens matching, keeps its exits usable while restoring, and Close returns when the hold ends',async t=>{
 const h=harness(t);h.$('connect').click();await settle();h.player.update(PLAYING);
 assert.equal(h.$('matching').hidden,true);
 h.player.update({...PLAYING,holding:true,restoring:20});
 assert.equal(h.$('matching').hidden,false);assert.equal(h.$('match-close').hidden,true);
 assert.equal(h.$('hold').textContent,'Resume with this delay');assert.equal(h.$('hold').disabled,false);assert.equal(h.$('cancel').disabled,false);
 h.$('cancel').click();await settle();assert.deepEqual(h.player.lastCommand,{type:'cancel',value:undefined});
 h.player.update(PLAYING);assert.equal(h.$('match-close').hidden,false);assert.equal(h.$('hold').textContent,'Pause to match TV');
});
test('direction groups keep production signs: Less delay sends negative nudges, More delay positive',async t=>{
 const h=harness(t);h.$('connect').click();await settle();h.player.update(PLAYING);
 const less=[...h.w.document.querySelectorAll('[aria-labelledby=less-delay] [data-nudge]')],more=[...h.w.document.querySelectorAll('[aria-labelledby=more-delay] [data-nudge]')];
 assert.deepEqual(less.map(b=>Number(b.dataset.nudge)),[-5,-1,-0.25]);assert.deepEqual(more.map(b=>Number(b.dataset.nudge)),[0.25,1,5]);
 for(const button of [...less,...more]){button.click();await settle();assert.deepEqual(h.player.lastCommand,{type:'nudge',value:Number(button.dataset.nudge)});
  assert.match(button.getAttribute('aria-label'),Number(button.dataset.nudge)<0?/^Reduce delay/:/^Add /);}
});
test('the owner strip keeps radio state, its last error and Stop reachable while browsing; modals mirror the warning',async t=>{
 const h=harness(t);h.$('connect').click();await settle();h.player.update(PLAYING);
 assert.equal(h.$('owner-strip').hidden,false);assert.equal(h.$('owner-state').textContent,'Playing');assert.equal(h.$('owner-name').textContent,'Duke Sports Network');
 h.player.event('source-reconnect-exhausted');h.player.update(null);await settle();
 assert.equal(h.$('owner-strip').hidden,false,'the error stays visible after the session ends');
 assert.match(h.w.document.querySelector('#owner-strip [data-warning-mirror]').textContent,/three attempts/);
 assert.match(h.w.document.querySelector('#logs-dialog [data-warning-mirror]').textContent,/three attempts/);
 h.$('connect').click();await settle();h.player.update(PLAYING);await settle();
 assert.equal(h.w.document.querySelector('#logs-dialog [data-warning-mirror]').textContent,'','a recovered session clears the mirror');
 h.$('owner-stop').click();assert.equal(h.player.audio,null);assert.equal(h.$('owner-strip').hidden,true);
});
test('storage warnings stay global and are mirrored read-only into every tool dialog',async t=>{
 const h=harness(t);h.$('storage-warning').textContent='Log storage is unavailable. Keep this page open and share or download the log before leaving.';await settle();
 for(const id of ['confirm-dialog','help-dialog','context-dialog','logs-dialog','tone-dialog'])assert.match(h.w.document.querySelector(`#${id} [data-warning-mirror]`).textContent,/storage is unavailable/,id);
 assert.equal(h.$('storage-warning').closest('dialog'),null);
});
test('test tone leaves the current view through navigation before starting exactly one ordinary owner',async t=>{
 const order=[];let h;
 h=harness(t,undefined,{setupArchive:()=>({select:(mode,options)=>order.push(['select',mode,options?.force,h.player.starts.length])})});
 h.$('connect').click();await settle();h.player.update(PLAYING);
 h.$('demo').click();
 assert.deepEqual(order,[['select','live',true,1]],'navigation teardown happens before the demo starts');
 assert.equal(h.player.starts.length,2);assert.equal(h.player.starts[1].url,'blob:demo');assert.equal(h.$('station').textContent,'Timing demo · repeating tones');
});
test('test context locks TV service and output during a session while the reason stays editable',async t=>{
 const h=harness(t);h.$('connect').click();await settle();
 assert.equal(h.$('provider').disabled,true);assert.equal(h.$('output').disabled,true);assert.equal(h.$('reason').disabled,false);assert.equal(h.$('context-lock').hidden,false);
 h.$('stop').click();assert.equal(h.$('provider').disabled,false);assert.equal(h.$('context-lock').hidden,true);
});
test('log removal refuses during playback without claiming success',async t=>{
 const h=harness(t);h.$('connect').click();await settle();h.$('stop').click();
 h.$('connect').click();await settle();h.$('clear-confirm').hidden=false;h.$('clear-confirm').click();
 assert.doesNotMatch(h.$('share-status').textContent,/removed\./);assert.ok(h.w.localStorage.length>1);
 h.$('stop').click();h.$('clear').click();h.$('clear-confirm').click();assert.equal(h.$('share-status').textContent,'Saved logs removed.');
});
