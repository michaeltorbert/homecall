import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import { metadataURL } from '../src/gateway.js';
import { createTimingFreshness, nextPollDelay } from '../src/timing-freshness.js';
import * as mapping from '../src/sync-mapping.js';
const source=fs.readFileSync(new URL('../src/sync.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function','function');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function harness(t,{delayTeams=false,duplicate=false,ageMs=0,requestMs=0,delayPlays=false,wrongEvent=false,failSchedule=false,gateway='',timingSource='gateway'}={}){
 const dom=new JSDOM(html,{url:'http://example.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;t.after(()=>w.close());
 w.__GATEWAY_ORIGIN__=gateway;const requests=[],browserRequests=[];
 const base=Date.now(),school='Duke',game={id:'one',opponent:'Illinois',start:base,url:'https://gateway.example/media/game/team/one'};
 const plays=[{id:'a',quarter:1,clock:'10:00',utc:base+10000,text:'First play'},{id:'b',quarter:1,clock:duplicate?'10:00':'9:00',utc:base+20000,text:'Second play'}];
 let player,catalog,resolveTeams,resolvePlays,failPlays=false;
 const providerTeam={id:'150',name:school,homestreamId:'duke'};
 let localNow=100000;const timers=[];
 w.setTimeout=(callback,ms)=>{const timer={callback,ms,cancelled:false};timers.push(timer);return timer;};w.clearTimeout=timer=>{if(timer)timer.cancelled=true;};
 class FakePlayer {constructor(){player=this;this.active=false;this.seeks=[]}stop(){this.active=false}start(){this.active=true}timing(){return {utc:base+25000,position:25,ranges:[[0,30]],spans:[{utc:base,position:0,duration:30}]}}seek(p){this.seeks.push(p);return true}live(){return true}}
 const readJSON=async url=>{
  requests.push(url.href);
  if(url.pathname.endsWith('/homestream/teams'))return[{id:'duke',name:school},{id:'gt',name:'Georgia Tech'},{id:'uva',name:'Virginia'},{id:'aub',name:'Auburn'}];
  if(url.pathname.endsWith('/sync/teams'))return delayTeams?new Promise(r=>resolveTeams=r):[providerTeam];
  if(url.pathname.includes('/schedule/')) { if(failSchedule)throw Error('schedule');return[{id:'event',start:base,teams:[school,game.opponent],teamIds:['150','356'],season:mapping.footballSeason(base)}]; }
  if(failPlays)throw Error('unavailable');
  localNow+=requestMs;const value={schemaVersion:2,eventId:wrongEvent?'other':'event',teamIds:['150','356'],season:mapping.footballSeason(base),plays:plays.map(p=>({...p})),conflict:true,checkedAt:base,ageMs};
  return delayPlays?new Promise(resolve=>resolvePlays=()=>resolve(value)):value;
 };
 Object.assign(w,{...mapping,metadataURL,createTimingFreshness:()=>createTimingFreshness({clock:()=>({wall:localNow,mono:localNow})}),nextPollDelay,browserTiming:async path=>{browserRequests.push(path);return readJSON(new URL('/api/'+path,'https://browser-provider.test'));},SyncPlayer:FakePlayer,readJSON,setupHomestream:callbacks=>(catalog={ready:null,setEnabled(v){this.ready=v?game:null;if(v){callbacks.onChange();callbacks.onReady()}},async refresh(){callbacks.onChange();callbacks.onReady()}})});
 w.eval(source+';window.setup=setupSync;');const ui=w.setup();w.document.getElementById('sync-timing-source').value=timingSource;return{ui,w,player,game,timers,requests,browserRequests,plays,recoverSchedule:()=>failSchedule=false,advance:ms=>localNow+=ms,fail:()=>failPlays=true,recover:()=>failPlays=false,resolvePlays:()=>resolvePlays(),get catalog(){return catalog},resolveTeams:x=>resolveTeams(x),$:id=>w.document.getElementById('sync-'+id)};
}
test('Sync exposes all catalog schools, applies bounded clock and leaves outside requests unchanged',async t=>{
 const h=harness(t);h.ui.activate();await tick();assert.equal(h.$('team').options.length,4);h.$('play').click();await tick();
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
 assert.match(h.$('mapping-note').textContent,/Choose ESPN recorded plays/);
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
