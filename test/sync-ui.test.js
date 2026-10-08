import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import { metadataURL } from '../src/gateway.js';
import { createTimingFreshness, nextPollDelay } from '../src/timing-freshness.js';
import * as mapping from '../src/sync-mapping.js';
import { createGameStatus } from '../src/game-status.js';
import * as shell from '../src/ui-shell.js';
const source=fs.readFileSync(new URL('../src/sync.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function','function');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function harness(t,{delayTeams=false,duplicate=false,ageMs=0,requestMs=0,delayPlays=false,wrongEvent=false,failSchedule=false,gateway='',timingSource='gateway',unlisted=false,prompt=false,liveActive=()=>false}={}){
 const dom=new JSDOM(html,{url:'http://example.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;t.after(()=>w.close());
 w.__GATEWAY_ORIGIN__=gateway;const requests=[],browserRequests=[];
 const base=Date.now(),school='Duke',game={id:'one',opponent:'Illinois',start:base,url:'https://gateway.example/media/game/team/one'};
 const plays=[{id:'a',quarter:1,clock:'10:00',utc:base+10000,text:'First play'},{id:'b',quarter:1,clock:duplicate?'10:00':'9:00',utc:base+20000,text:'Second play'}];
 let player,catalog,resolveTeams,resolvePlays,failPlays=false;
 const providerTeam={id:'150',name:school,homestreamId:'duke'};
 let localNow=100000;const timers=[];
 w.setTimeout=(callback,ms)=>{const timer={callback,ms,cancelled:false};timers.push(timer);return timer;};w.clearTimeout=timer=>{if(timer)timer.cancelled=true;};
 class FakePlayer {constructor(audio,onStatus,options={}){player=this;this.onStatus=onStatus;this.active=false;this.seeks=[];this.onRecovery=options.onRecovery}stop(){this.active=false}start(){this.active=true}timing(){return {utc:base+25000,position:25,ranges:[[0,30]],spans:[{utc:base,position:0,duration:30}]}}seek(p){this.seeks.push(p);return true}live(){return true}}
 const readJSON=async url=>{
  requests.push(url.href);
  if(url.pathname.endsWith('/homestream/teams'))return[{id:'duke',name:school},{id:'gt',name:'Georgia Tech'},{id:'uva',name:'Virginia'},{id:'aub',name:'Auburn'}];
  if(url.pathname.endsWith('/sync/teams'))return delayTeams?new Promise(r=>resolveTeams=r):unlisted?[{id:'52',name:'Elsewhere',homestreamId:'other'}]:[providerTeam];
  if(url.pathname.includes('/schedule/')) { if(failSchedule)throw Error('schedule');return[{id:'event',start:base,teams:[school,game.opponent],teamIds:['150','356'],season:mapping.footballSeason(base)}]; }
  if(failPlays)throw Error('unavailable');
  localNow+=requestMs;const value={schemaVersion:2,eventId:wrongEvent?'other':'event',teamIds:['150','356'],season:mapping.footballSeason(base),plays:plays.map(p=>({...p})),conflict:true,checkedAt:base,ageMs};
  return delayPlays?new Promise(resolve=>resolvePlays=()=>resolve(value)):value;
 };
 Object.assign(w,{...mapping,metadataURL,createTimingFreshness:()=>createTimingFreshness({clock:()=>({wall:localNow,mono:localNow})}),nextPollDelay,browserTiming:async path=>{browserRequests.push(path);return readJSON(new URL('/api/'+path,'https://browser-provider.test'));},SyncPlayer:FakePlayer,readJSON,createGameStatus:options=>createGameStatus({...options,setTimer:()=>null,clearTimer:()=>{}}),setupHomestream:callbacks=>(catalog={callbacks,refreshes:0,ready:null,relabel(){},setEnabled(v){this.ready=v?game:null;if(v){callbacks.onChange();callbacks.onReady()}},async refresh(){this.refreshes++;callbacks.onChange();callbacks.onReady()}})});
 Object.assign(w,shell);
 let liveStops=0;w.eval(source+';window.setup=setupSync;');const ui=w.setup({stopLive:()=>{liveStops++;},liveActive,confirm:prompt?shell.createConfirm(w.document):null});w.document.getElementById('sync-timing-source').value=timingSource;
 const doc=w.document;
 return{ui,w,player,game,timers,requests,browserRequests,plays,liveStops:()=>liveStops,recoverSchedule:()=>failSchedule=false,advance:ms=>localNow+=ms,fail:()=>failPlays=true,recover:()=>failPlays=false,resolvePlays:()=>resolvePlays(),get catalog(){return catalog},resolveTeams:x=>resolveTeams(x),$:id=>doc.getElementById('sync-'+id),
  prompt:()=>doc.getElementById('confirm-dialog').hasAttribute('open'),proceed:()=>doc.getElementById('confirm-continue').click(),dismiss:()=>doc.getElementById('confirm-cancel').click()};
}
test('Sync exposes all catalog schools, applies bounded clock and leaves outside requests unchanged',async t=>{
 const h=harness(t);h.ui.activate();await tick();assert.equal(h.$('team').options.length,4);assert.equal(h.liveStops(),0);h.$('play').click();await tick();
 assert.equal(h.liveStops(),1,'starting a game stream stops live radio');
 assert.equal(h.$('apply').disabled,false);h.$('quarter').value='1';h.$('clock').value='10:00';h.$('clock-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));assert.equal(h.player.seeks.length,0);h.$('matches').children[0].click();assert.equal(h.player.seeks.at(-1),10);
 h.$('clock').value='12:00';h.$('clock-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));assert.equal(h.player.seeks.length,1);assert.match(h.$('result').textContent,/outside/);
 h.ui.deactivate();assert.equal(h.player.active,false);
});
test('duplicate clock requires choosing a play and new games clear the calibration',async t=>{
 const h=harness(t,{duplicate:true});h.ui.activate();await tick();h.$('play').click();h.$('clock').value='10:00';h.$('clock-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));assert.equal(h.player.seeks.length,0);assert.equal(h.$('matches').children.length,2);
 h.$('matches').children[1].click();assert.equal(h.player.seeks.at(-1),20);
 h.$('offset').value='10';h.game.id='two';await h.catalog.refresh();await tick();assert.equal(h.$('offset').value,'0');h.ui.deactivate();
});
test('leaving Sync cancels pending timing lookup and late results cannot revive controls',async t=>{
 const h=harness(t,{delayTeams:true});h.ui.activate();await tick();h.ui.deactivate();h.resolveTeams([{id:'150',name:'Duke',homestreamId:'duke'}]);await tick();assert.equal(h.$('apply').disabled,true);assert.match(h.$('mapping-note').textContent,/Waiting/);assert.equal(h.player.active,false);
});
test('server cache age plus request duration disables every clock seek path while manual controls remain usable',async t=>{
 const h=harness(t,{ageMs:44000,requestMs:1000});h.ui.activate();await tick();h.$('play').click();
 assert.equal(h.$('apply').disabled,true);assert.equal(h.$('incoming').disabled,false);
 h.$('clock').value='10:00';h.$('clock-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));assert.equal(h.player.seeks.length,0);assert.match(h.$('result').textContent,/recent snapshot/);
});
test('saved play choices expire at the same freshness boundary as render and form submission',async t=>{
 const h=harness(t,{duplicate:true});h.ui.activate();await tick();h.$('play').click();h.$('clock').value='10:00';h.$('clock-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));
 const choice=h.$('matches').children[0];assert.ok(choice);h.advance(45000);h.$('offset').dispatchEvent(new h.w.Event('input'));assert.equal(h.$('apply').disabled,true);
 choice.click();assert.equal(h.player.seeks.length,0);assert.match(h.$('result').textContent,/no longer/);
 h.$('clock-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));assert.equal(h.player.seeks.length,0);
});
test('hidden-tab transition aborts pending timing and requires new visible-tab data before seeking',async t=>{
 const h=harness(t,{delayPlays:true});h.ui.activate();await tick();h.$('play').click();
 Object.defineProperty(h.w.document,'visibilityState',{value:'hidden',configurable:true});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));
 h.resolvePlays();await tick();assert.equal(h.$('apply').disabled,true);assert.equal(h.player.active,true);
 Object.defineProperty(h.w.document,'visibilityState',{value:'visible',configurable:true});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));await tick();assert.equal(h.$('apply').disabled,true);
 h.resolvePlays();await tick();h.$('offset').dispatchEvent(new h.w.Event('input'));assert.equal(h.$('apply').disabled,false);
});
test('failed timing polls back off 15/30/60/120 seconds, reset on success, and are canceled when leaving Sync',async t=>{
 const h=harness(t);h.ui.activate();await tick();h.fail();
 for(let i=0;i<5;i++)await h.timers.at(-1).callback();
 assert.deepEqual(h.timers.map(x=>x.ms),[15000,15000,30000,60000,120000,120000]);
 h.recover();await h.timers.at(-1).callback();assert.equal(h.timers.at(-1).ms,15000);
 h.ui.deactivate();assert.equal(h.timers.at(-1).cancelled,true);
});

test('Sync uses the configured gateway for team discovery, schedule and play timing',async t=>{
 const h=harness(t,{gateway:'https://gateway.example'});h.ui.activate();await tick();assert.equal(h.requests.length,4);assert.ok(h.requests.every(url=>url.startsWith('https://gateway.example/api/')));
});


test('nearest clock shows distance and requires confirmation before moving audio',async t=>{
 const h=harness(t);h.ui.activate();await tick();h.$('play').click();h.$('clock').value='9:10';h.$('clock-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));
 assert.equal(h.player.seeks.length,0);assert.match(h.$('result').textContent,/10 game-clock seconds/);assert.equal(h.$('matches').children.length,1);
 h.$('matches').children[0].click();assert.equal(h.player.seeks.at(-1),20);
});
test('unknown upstream age displays anchors but only manual audio remains enabled',async t=>{
 const h=harness(t,{ageMs:null});h.ui.activate();await tick();h.$('play').click();
 assert.equal(h.$('apply').disabled,true);assert.equal(h.$('incoming').disabled,false);assert.match(h.$('range').textContent,/freshness unknown/);
 assert.match(h.$('mapping-note').textContent,/[Ff]reshness is unknown/);
});
test('wrong event envelope cannot enable game-clock seeking',async t=>{
 const h=harness(t,{wrongEvent:true});h.ui.activate();await tick();h.$('play').click();assert.equal(h.$('apply').disabled,true);assert.equal(h.$('incoming').disabled,false);
 assert.equal(h.$('timing-retry').hidden,false);
});
test('timing lookup retry reacquires anchors without restarting audio',async t=>{
 const h=harness(t,{failSchedule:true});h.ui.activate();await tick();h.$('play').click();assert.equal(h.$('timing-retry').hidden,false);assert.equal(h.player.active,true);
 h.recoverSchedule();h.$('timing-retry').click();await tick();assert.equal(h.player.active,true);assert.equal(h.$('apply').disabled,false);assert.equal(h.$('timing-retry').hidden,true);
});
test('new snapshot invalidates saved choices, including corrected play timestamps',async t=>{
 const h=harness(t,{duplicate:true});h.ui.activate();await tick();h.$('play').click();h.$('clock').value='10:00';h.$('clock-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));
 const old=h.$('matches').children[0];h.plays[0].utc+=1000;await h.timers.at(-1).callback();old.click();assert.equal(h.player.seeks.length,0);assert.match(h.$('result').textContent,/no longer/);
});
test('same event with a different feed clears calibration',async t=>{
 const h=harness(t);h.ui.activate();await tick();h.$('offset').value='5';h.game.url='https://gateway.example/media/game/team/two';await h.catalog.refresh();await tick();assert.equal(h.$('offset').value,'0');
});

test('browser recorded-play mode is explicit and transport changes keep audio playing',async t=>{
 const h=harness(t);h.ui.activate();await tick();h.$('play').click();assert.equal(h.browserRequests.length,0);assert.equal(h.$('apply').disabled,false);
 h.$('offset').value='3';h.$('timing-source').value='browser';h.$('timing-source').dispatchEvent(new h.w.Event('change'));assert.equal(h.$('apply').disabled,true);await tick();
 assert.equal(h.player.active,true);assert.equal(h.$('offset').value,'0');assert.equal(h.$('apply').disabled,false);assert.equal(h.browserRequests.length,2);assert.match(h.$('mapping-note').textContent,/freshness unknown/);
 h.$('timing-source').value='gateway';h.$('timing-source').dispatchEvent(new h.w.Event('change'));await tick();assert.equal(h.$('apply').disabled,false);assert.equal(h.player.active,true);
});


test('no timing source is chosen implicitly; manual playback remains available',async t=>{
 const h=harness(t,{timingSource:''});h.ui.activate();await tick();h.$('play').click();
 assert.equal(h.requests.length,1);assert.equal(h.browserRequests.length,0);assert.equal(h.$('apply').disabled,true);assert.equal(h.$('incoming').disabled,false);
 assert.match(h.$('mapping-note').textContent,/Choose a timing source/);
});
test('historical mode keeps unknown age and requires a described-play confirmation even for an exact single match',async t=>{
 const h=harness(t,{timingSource:'browser',ageMs:null});h.ui.activate();await tick();h.$('play').click();h.$('clock').value='10:00';
 h.advance(45000);h.$('clock-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));
 assert.equal(h.player.seeks.length,0);assert.equal(h.$('matches').children.length,1);assert.match(h.$('matches').textContent,/First play/);assert.match(h.$('range').textContent,/freshness unknown/);
 h.$('matches').children[0].click();assert.equal(h.player.seeks.at(-1),10);assert.match(h.$('result').textContent,/does not confirm alignment/);
});
test('historical seek choices fail closed on poll failure, correction, stop, hidden tab and moving audio window',async t=>{
 const h=harness(t,{timingSource:'browser',ageMs:null});h.ui.activate();await tick();h.$('play').click();h.$('clock').value='10:00';
 const choice=()=>{h.$('clock-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));return h.$('matches').children[0];};
 let b=choice();h.fail();await h.timers.at(-1).callback();b.click();assert.equal(h.player.seeks.length,0);assert.equal(h.$('apply').disabled,true);assert.equal(h.$('incoming').disabled,false);
 h.recover();await h.timers.at(-1).callback();b=choice();h.plays[0].utc+=1000;await h.timers.at(-1).callback();b.click();assert.equal(h.player.seeks.length,0);
 b=choice();const original=h.player.timing;h.player.timing=()=>({...original(),ranges:[[25,30]]});b.click();assert.equal(h.player.seeks.length,0);h.player.timing=original;
 b=choice();h.$('stop').click();b.click();assert.equal(h.player.seeks.length,0);h.$('play').click();b.click();assert.equal(h.player.seeks.length,0);
 b=choice();Object.defineProperty(h.w.document,'visibilityState',{value:'hidden',configurable:true});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));b.click();assert.equal(h.player.seeks.length,0);
});
test('with no timing source the clock form stays visible but disabled, directly below the source choice',async t=>{
 const h=harness(t,{timingSource:''});h.ui.activate();await tick();h.$('play').click();
 assert.equal(h.$('clock-form').hidden,false);assert.equal(h.$('clock-fields').disabled,true);assert.equal(h.$('apply').disabled,true);
 assert.ok(h.$('timing-source').compareDocumentPosition(h.$('clock-form'))&h.w.Node.DOCUMENT_POSITION_FOLLOWING);
 assert.equal(h.$('timing-source').value,'','no source is chosen for the listener');
 h.$('timing-source').value='gateway';h.$('timing-source').dispatchEvent(new h.w.Event('change'));await tick();
 assert.equal(h.$('clock-fields').disabled,false);assert.equal(h.$('apply').disabled,false);
});
test('only an explicit unsupported answer hides the clock form; failed or stale lookups keep it visible with manual controls',async t=>{
 const unsupported=harness(t,{unlisted:true});unsupported.ui.activate();await tick();unsupported.$('play').click();await tick();
 assert.equal(unsupported.$('clock-form').hidden,true);assert.match(unsupported.$('mapping-note').textContent,/isn’t available for this school/);
 assert.equal(unsupported.$('incoming').disabled,false);assert.equal(unsupported.$('timing-source').hidden,false,'source choice stays reachable');
 const failed=harness(t,{failSchedule:true});failed.ui.activate();await tick();failed.$('play').click();
 assert.equal(failed.$('clock-form').hidden,false);assert.equal(failed.$('clock-fields').disabled,true);assert.equal(failed.$('timing-retry').hidden,false);assert.equal(failed.$('incoming').disabled,false);
 const stale=harness(t,{ageMs:44000,requestMs:1000});stale.ui.activate();await tick();stale.$('play').click();
 assert.equal(stale.$('clock-form').hidden,false);assert.equal(stale.$('clock-fields').disabled,true);assert.equal(stale.$('incoming').disabled,false);
});
test('Back moves audio earlier (more delay) and Ahead later (less delay) with production signs',async t=>{
 const h=harness(t);h.ui.activate();await tick();h.$('play').click();
 const back=[...h.w.document.querySelectorAll('[aria-labelledby=sync-back] [data-sync-nudge]')],ahead=[...h.w.document.querySelectorAll('[aria-labelledby=sync-ahead] [data-sync-nudge]')];
 assert.deepEqual(back.map(b=>Number(b.dataset.syncNudge)),[-1,-0.25]);assert.deepEqual(ahead.map(b=>Number(b.dataset.syncNudge)),[0.25,1]);
 const audio=h.w.document.getElementById('sync-audio');
 for(const b of [...back,...ahead]){b.click();assert.equal(h.player.seeks.at(-1),audio.currentTime+Number(b.dataset.syncNudge));assert.match(b.getAttribute('aria-label'),Number(b.dataset.syncNudge)<0?/back/:/ahead/);}
});
test('radio takeover, reconnect, school change and reload confirm before stopping; Cancel changes nothing',async t=>{
 let radio=true;const h=harness(t,{prompt:true,liveActive:()=>radio});h.ui.activate();await tick();
 h.$('play').click();assert.equal(h.prompt(),true);assert.equal(h.liveStops(),0);assert.equal(h.player.active,false);
 h.dismiss();assert.equal(h.liveStops(),0);assert.equal(h.player.active,false);
 h.$('play').click();h.proceed();assert.equal(h.liveStops(),1);assert.equal(h.player.active,true,'Continue starts the stream inside its own click');
 radio=false;const refreshes=h.catalog.refreshes;
 h.$('play').click();assert.equal(h.prompt(),true);h.dismiss();assert.equal(h.catalog.refreshes,refreshes);assert.equal(h.player.active,true);
 const committed=h.$('team').value;h.$('team').value='gt';h.$('team').dispatchEvent(new h.w.Event('change'));
 assert.equal(h.prompt(),true);assert.equal(h.$('team').value,committed);h.dismiss();assert.equal(h.player.active,true);assert.equal(h.$('team').value,committed);
 h.$('teams-retry').click();assert.equal(h.prompt(),true);h.dismiss();assert.equal(h.player.active,true);
 h.catalog.callbacks.guard('game',()=>assert.fail('a pending game change must not run'),()=>{});assert.equal(h.prompt(),true);h.dismiss();assert.equal(h.player.active,true);
 h.$('play').click();h.proceed();await tick();assert.equal(h.catalog.refreshes,refreshes+1);assert.equal(h.player.active,false,'Continue reconnects through the catalog refresh');
});
test('a terminal stop or recovery invalidates a pending broadcast prompt',async t=>{
 const h=harness(t,{prompt:true});h.ui.activate();await tick();h.$('play').click();
 const refreshes=h.catalog.refreshes;
 h.$('play').click();assert.equal(h.prompt(),true);
 h.player.active=false;h.player.onRecovery({type:'stopped'});assert.equal(h.prompt(),false);assert.equal(h.$('playback').dataset.alert,'on');
 h.proceed();assert.equal(h.catalog.refreshes,refreshes,'a stale Continue does nothing');
 h.$('play').click();assert.equal(h.player.active,true);assert.equal(h.$('playback').dataset.alert,'','starting again clears the flag');
});
test('invalidated play choices take their invitation with them; newer manual feedback stays',async t=>{
 const h=harness(t,{duplicate:true});h.ui.activate();await tick();h.$('play').click();h.$('clock').value='10:00';
 const find=()=>h.$('clock-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));
 find();assert.match(h.$('result').textContent,/Several plays match/);const stale=h.$('matches').children[0];
 await h.timers.at(-1).callback();
 assert.equal(h.$('matches').children.length,0);assert.equal(h.$('result').textContent,'','a refreshed snapshot removes the stale invitation');
 stale.click();assert.equal(h.player.seeks.length,0,'the stale choice cannot seek');assert.match(h.$('result').textContent,/no longer/);
 find();h.$('offset').value='1';h.$('offset').dispatchEvent(new h.w.Event('input'));assert.equal(h.$('result').textContent,'','an offset change clears it too');
 find();h.player.onRecovery({type:'reconnecting'});assert.equal(h.$('result').textContent,'','recovery clears it too');
 find();h.w.document.querySelector('[data-sync-nudge="1"]').click();assert.match(h.$('result').textContent,/Audio adjusted/);
 await h.timers.at(-1).callback();assert.equal(h.$('matches').children.length,0);assert.match(h.$('result').textContent,/Audio adjusted/,'manual feedback survives invalidation');
 h.$('clock').value='12:00';find();assert.match(h.$('result').textContent,/outside/);h.$('offset').dispatchEvent(new h.w.Event('input'));assert.match(h.$('result').textContent,/outside/,'an error is not an invitation');
});
const seekGate=h=>({form:h.$('clock-form').hidden,fields:h.$('clock-fields').disabled,apply:h.$('apply').disabled,retry:h.$('timing-retry').hidden,incoming:h.$('incoming').disabled});
test('gateway timing with unknown age keeps the clock form visible but disabled and Retry reachable',async t=>{
 const h=harness(t,{ageMs:null});h.ui.activate();await tick();h.$('play').click();
 assert.deepEqual(seekGate(h),{form:false,fields:true,apply:true,retry:false,incoming:false});
});
test('stale gateway timing keeps the clock form visible but disabled and Retry reachable',async t=>{
 const h=harness(t,{ageMs:44000,requestMs:1000});h.ui.activate();await tick();h.$('play').click();
 assert.deepEqual(seekGate(h),{form:false,fields:true,apply:true,retry:false,incoming:false});
});
test('fresh gateway timing that ages to stale offers Retry; a valid retry restores seeking without restarting audio',async t=>{
 const h=harness(t);h.ui.activate();await tick();h.$('play').click();
 assert.deepEqual(seekGate(h),{form:false,fields:false,apply:false,retry:true,incoming:false});
 const starts=h.player.start;let restarted=0;h.player.start=function(...args){restarted++;return starts.apply(this,args);};
 h.advance(45000);h.$('offset').dispatchEvent(new h.w.Event('input'));
 assert.deepEqual(seekGate(h),{form:false,fields:true,apply:true,retry:false,incoming:false});
 const polls=h.timers.filter(x=>!x.cancelled).length;
 h.$('timing-retry').click();await tick();
 assert.deepEqual(seekGate(h),{form:false,fields:false,apply:false,retry:true,incoming:false});
 assert.equal(h.player.active,true);assert.equal(restarted,0);assert.equal(h.liveStops(),1,'retry never touches audio ownership');
 assert.equal(h.timers.filter(x=>!x.cancelled).length,polls,'the old poll is replaced, not duplicated');
});
test('browser historical timing with unknown freshness keeps confirmed seeking and no Retry warning',async t=>{
 const h=harness(t,{timingSource:'browser',ageMs:null});h.ui.activate();await tick();h.$('play').click();
 h.advance(45000);h.$('offset').dispatchEvent(new h.w.Event('input'));
 assert.deepEqual(seekGate(h),{form:false,fields:false,apply:false,retry:true,incoming:false});
});
test('an unverified-position fallback stays mirrored into an open tool until the player shows a newer status',async t=>{
 const h=harness(t);h.ui.activate();await tick();h.$('play').click();
 const doc=h.w.document;shell.setupShell({doc});shell.openDialog(doc.getElementById('logs-dialog'));
 const mirror=()=>doc.querySelector('#logs-dialog [data-warning-mirror]').textContent;
 h.player.onStatus('Connection lost. Reconnecting to the same broadcast.');h.player.onRecovery({type:'reconnecting'});await tick();
 assert.match(mirror(),/Connection lost/);
 const fallback='Reconnected at incoming audio; your earlier position could not be verified. Check alignment.';
 h.player.onStatus(fallback);h.player.onRecovery({type:'fallback',reason:'moved'});await tick();
 assert.equal(mirror(),fallback,'the exact controller-written fallback warning is mirrored');
 h.player.onStatus(fallback);await tick();assert.equal(mirror(),fallback,'repeating the same notice on playing keeps it');
 h.player.onStatus('Audio paused.');await tick();assert.equal(mirror(),'','a newer status clears it');
 h.player.onStatus('Connection lost. Reconnecting to the same broadcast.');h.player.onRecovery({type:'reconnecting'});h.player.onStatus('Reconnected.');h.player.onRecovery({type:'restored'});await tick();
 assert.equal(mirror(),'','a verified restoration is not a warning');
 h.player.onStatus('The stream stopped.');h.player.onRecovery({type:'stopped'});await tick();assert.match(mirror(),/stream stopped/);
 h.$('stop').click();await tick();assert.equal(mirror(),'');
});
test('Sync recovery clears old play choices and rerenders without losing calibration or timing source',async t=>{
 const h=harness(t,{timingSource:'browser',ageMs:null});h.ui.activate();await tick();h.$('play').click();
 h.$('offset').value='3';h.$('offset').dispatchEvent(new h.w.Event('input'));h.$('clock').value='10:00';h.$('clock-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));
 const old=h.$('matches').children[0];assert.ok(old);
 h.$('stop').disabled=true;h.player.onRecovery({type:'reconnecting'});
 assert.equal(h.$('matches').children.length,0);assert.equal(h.$('stop').disabled,false,'Stop stays usable while the player retains recovery');
 old.click();assert.equal(h.player.seeks.length,0);assert.match(h.$('result').textContent,/no longer/);
 h.player.onRecovery({type:'restored'});
 assert.equal(h.$('offset').value,'3');assert.equal(h.$('timing-source').value,'browser');
 h.$('clock-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));h.$('matches').children[0].click();assert.equal(h.player.seeks.at(-1),13);
});
