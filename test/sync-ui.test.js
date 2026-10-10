// Listen game-timing tools (src/sync.js) against the real index.html. The player and seek adapters are
// fakes: these tests prove timing gates and confirmation, not media movement (see player.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import { metadataURL } from '../src/gateway.js';
import { createTimingFreshness, nextPollDelay } from '../src/timing-freshness.js';
import * as mapping from '../src/sync-mapping.js';
const source=fs.readFileSync(new URL('../src/sync.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export function/g,'function');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function harness(t,{delayTeams=false,duplicate=false,ageMs=0,requestMs=0,delayPlays=false,wrongEvent=false,failSchedule=false,gateway='',timingSource='gateway',unlisted=false,seekResult='applied'}={}){
 const dom=new JSDOM(html,{url:'http://example.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;t.after(()=>w.close());
 w.__GATEWAY_ORIGIN__=gateway;const requests=[],browserRequests=[],seeks=[];
 const base=Date.now(),school='Duke',game={id:'one',opponent:'Illinois',start:base,url:'https://gateway.example/media/game/team/one'};
 const plays=[{id:'a',quarter:1,clock:'10:00',utc:base+10000,text:'First play'},{id:'b',quarter:1,clock:duplicate?'10:00':'9:00',utc:base+20000,text:'Second play'}];
 let resolveTeams,resolvePlays,failPlays=false;
 const providerTeam={id:'150',name:school,homestreamId:'duke-id'};
 let localNow=100000;const timers=[];
 w.setTimeout=(callback,ms)=>{const timer={callback,ms,cancelled:false};timers.push(timer);return timer;};w.clearTimeout=timer=>{if(timer)timer.cancelled=true;};
 // Audible timestamp mapped through verified PCM continuity; movable is false while paused, held or restoring.
 const player={movable:true,timing(){return {utc:base+25000,position:25,ranges:[[0,30]],spans:[{utc:base,position:0,duration:30}]}},canMove(){return this.movable;}};
 const readJSON=async url=>{
  requests.push(url.href);
  if(url.pathname.endsWith('/sync/teams'))return delayTeams?new Promise(r=>resolveTeams=r):unlisted?[{id:'52',name:'Elsewhere',homestreamId:'other'}]:[providerTeam];
  if(url.pathname.includes('/schedule/')) { if(failSchedule)throw Error('schedule');return[{id:'event',start:base,teams:[school,game.opponent],teamIds:['150','356'],season:mapping.footballSeason(base)}]; }
  if(failPlays)throw Error('unavailable');
  localNow+=requestMs;const value={schemaVersion:2,eventId:wrongEvent?'other':'event',teamIds:['150','356'],season:mapping.footballSeason(base),plays:plays.map(p=>({...p})),conflict:true,checkedAt:base,ageMs};
  return delayPlays?new Promise(resolve=>resolvePlays=()=>resolve(value)):value;
 };
 Object.assign(w,{...mapping,metadataURL,createTimingFreshness:()=>createTimingFreshness({clock:()=>({wall:localNow,mono:localNow})}),nextPollDelay,browserTiming:async path=>{browserRequests.push(path);return readJSON(new URL('/api/'+path,'https://browser-provider.test'));},readJSON});
 w.eval(source+';window.setup=setupGameTiming;');
 const ui=w.setup({player,seek:async position=>{seeks.push(position);return seekResult;},schoolName:()=>school,teamId:()=>'duke-id'});
 w.document.getElementById('sync-timing-source').value=timingSource;
 const doc=w.document;
 return{ui,w,player,seeks,game,timers,requests,browserRequests,plays,start:()=>ui.start(game),recoverSchedule:()=>failSchedule=false,advance:ms=>localNow+=ms,fail:()=>failPlays=true,recover:()=>failPlays=false,resolvePlays:()=>resolvePlays(),resolveTeams:x=>resolveTeams(x),$:id=>doc.getElementById('sync-'+id),
  submit:()=>doc.getElementById('sync-clock-form').dispatchEvent(new w.Event('submit',{cancelable:true}))};
}
test('clock lookup applies a bounded clock and leaves outside requests unchanged',async t=>{
 const h=harness(t);h.start();await tick();
 assert.equal(h.$('apply').disabled,false);h.$('quarter').value='1';h.$('clock').value='10:00';h.submit();assert.equal(h.seeks.length,0);h.$('matches').children[0].click();await tick();assert.deepEqual(h.seeks,[10]);
 h.$('clock').value='12:00';h.submit();assert.equal(h.seeks.length,1);assert.match(h.$('result').textContent,/outside/);
 h.ui.stop();assert.equal(h.$('apply').disabled,true);
});
test('duplicate clock requires choosing a play and new games clear the calibration',async t=>{
 const h=harness(t,{duplicate:true});h.start();await tick();h.$('clock').value='10:00';h.submit();assert.equal(h.seeks.length,0);assert.equal(h.$('matches').children.length,2);
 h.$('matches').children[1].click();await tick();assert.deepEqual(h.seeks,[20]);
 h.$('offset').value='10';h.ui.start({...h.game,id:'two'});await tick();assert.equal(h.$('offset').value,'0');h.ui.stop();
});
test('stopping cancels a pending timing lookup and late results cannot revive controls',async t=>{
 const h=harness(t,{delayTeams:true});h.start();await tick();h.ui.stop();h.resolveTeams([{id:'150',name:'Duke',homestreamId:'duke-id'}]);await tick();
 assert.equal(h.$('apply').disabled,true);assert.match(h.$('mapping-note').textContent,/Waiting/);
});
test('server cache age plus request duration disables every clock seek path',async t=>{
 const h=harness(t,{ageMs:44000,requestMs:1000});h.start();await tick();
 assert.equal(h.$('apply').disabled,true);
 h.$('clock').value='10:00';h.submit();assert.equal(h.seeks.length,0);assert.match(h.$('result').textContent,/recent snapshot/);
});
test('saved play choices expire at the same freshness boundary as render and form submission',async t=>{
 const h=harness(t,{duplicate:true});h.start();await tick();h.$('clock').value='10:00';h.submit();
 const choice=h.$('matches').children[0];assert.ok(choice);h.advance(45000);h.$('offset').dispatchEvent(new h.w.Event('input'));assert.equal(h.$('apply').disabled,true);
 choice.click();await tick();assert.equal(h.seeks.length,0);assert.match(h.$('result').textContent,/no longer/);
 h.submit();assert.equal(h.seeks.length,0);
});
test('hidden-tab transition aborts pending timing and requires new visible-tab data before seeking',async t=>{
 const h=harness(t,{delayPlays:true});h.start();await tick();
 Object.defineProperty(h.w.document,'visibilityState',{value:'hidden',configurable:true});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));
 h.resolvePlays();await tick();assert.equal(h.$('apply').disabled,true);
 Object.defineProperty(h.w.document,'visibilityState',{value:'visible',configurable:true});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));await tick();assert.equal(h.$('apply').disabled,true);
 h.resolvePlays();await tick();h.$('offset').dispatchEvent(new h.w.Event('input'));assert.equal(h.$('apply').disabled,false);
});
test('failed timing polls back off 15/30/60/120 seconds, reset on success, and are canceled when the game feed stops',async t=>{
 const h=harness(t);h.start();await tick();h.fail();
 for(let i=0;i<5;i++)await h.timers.at(-1).callback();
 assert.deepEqual(h.timers.map(x=>x.ms),[15000,15000,30000,60000,120000,120000]);
 h.recover();await h.timers.at(-1).callback();assert.equal(h.timers.at(-1).ms,15000);
 h.ui.stop();assert.equal(h.timers.at(-1).cancelled,true);
});
test('game timing uses the configured gateway for team discovery, schedule and play timing',async t=>{
 const h=harness(t,{gateway:'https://gateway.example'});h.start();await tick();assert.equal(h.requests.length,3);assert.ok(h.requests.every(url=>url.startsWith('https://gateway.example/api/')));
});
test('nearest clock shows distance and requires confirmation before moving audio',async t=>{
 const h=harness(t);h.start();await tick();h.$('clock').value='9:10';h.submit();
 assert.equal(h.seeks.length,0);assert.match(h.$('result').textContent,/10 game-clock seconds/);assert.equal(h.$('matches').children.length,1);
 h.$('matches').children[0].click();await tick();assert.deepEqual(h.seeks,[20]);
});
test('unknown upstream age displays anchors but keeps seeking disabled',async t=>{
 const h=harness(t,{ageMs:null});h.start();await tick();
 assert.equal(h.$('apply').disabled,true);assert.match(h.$('range').textContent,/freshness unknown/);
 assert.match(h.$('mapping-note').textContent,/[Ff]reshness is unknown/);
});
test('wrong event envelope cannot enable game-clock seeking',async t=>{
 const h=harness(t,{wrongEvent:true});h.start();await tick();assert.equal(h.$('apply').disabled,true);
 assert.equal(h.$('timing-retry').hidden,false);
});
test('timing lookup retry reacquires anchors without moving audio',async t=>{
 const h=harness(t,{failSchedule:true});h.start();await tick();assert.equal(h.$('timing-retry').hidden,false);
 h.recoverSchedule();h.$('timing-retry').click();await tick();assert.equal(h.seeks.length,0);assert.equal(h.$('apply').disabled,false);assert.equal(h.$('timing-retry').hidden,true);
});
test('new snapshot invalidates saved choices, including corrected play timestamps',async t=>{
 const h=harness(t,{duplicate:true});h.start();await tick();h.$('clock').value='10:00';h.submit();
 const old=h.$('matches').children[0];h.plays[0].utc+=1000;await h.timers.at(-1).callback();old.click();await tick();assert.equal(h.seeks.length,0);assert.match(h.$('result').textContent,/no longer/);
});
test('same event with a different feed clears calibration',async t=>{
 const h=harness(t);h.start();await tick();h.$('offset').value='5';h.ui.start({...h.game,url:'https://gateway.example/media/game/team/two'});await tick();assert.equal(h.$('offset').value,'0');
});
test('browser recorded-play mode is explicit and transport changes never move audio',async t=>{
 const h=harness(t);h.start();await tick();assert.equal(h.browserRequests.length,0);assert.equal(h.$('apply').disabled,false);
 h.$('offset').value='3';h.$('timing-source').value='browser';h.$('timing-source').dispatchEvent(new h.w.Event('change'));assert.equal(h.$('apply').disabled,true);await tick();
 assert.equal(h.$('offset').value,'0');assert.equal(h.$('apply').disabled,false);assert.equal(h.browserRequests.length,2);assert.match(h.$('mapping-note').textContent,/freshness unknown/);
 h.$('timing-source').value='gateway';h.$('timing-source').dispatchEvent(new h.w.Event('change'));await tick();assert.equal(h.$('apply').disabled,false);assert.equal(h.seeks.length,0);
});
test('no timing source is chosen implicitly; manual playback remains available',async t=>{
 const h=harness(t,{timingSource:''});h.start();await tick();
 assert.equal(h.requests.length,0);assert.equal(h.browserRequests.length,0);assert.equal(h.$('apply').disabled,true);
 assert.match(h.$('mapping-note').textContent,/Choose a timing source/);
});
test('historical mode keeps unknown age and requires a described-play confirmation even for an exact single match',async t=>{
 const h=harness(t,{timingSource:'browser',ageMs:null});h.start();await tick();h.$('clock').value='10:00';
 h.advance(45000);h.submit();
 assert.equal(h.seeks.length,0);assert.equal(h.$('matches').children.length,1);assert.match(h.$('matches').textContent,/First play/);assert.match(h.$('range').textContent,/freshness unknown/);
 h.$('matches').children[0].click();await tick();assert.deepEqual(h.seeks,[10]);assert.match(h.$('result').textContent,/does not confirm alignment/);
});
test('historical seek choices fail closed on poll failure, correction, stop, paused output, hidden tab and moving audio window',async t=>{
 const h=harness(t,{timingSource:'browser',ageMs:null});h.start();await tick();h.$('clock').value='10:00';
 const choice=()=>{h.submit();return h.$('matches').children[0];};
 const none=async b=>{b.click();await tick();assert.equal(h.seeks.length,0);};
 let b=choice();h.fail();await h.timers.at(-1).callback();await none(b);assert.equal(h.$('apply').disabled,true);
 h.recover();await h.timers.at(-1).callback();b=choice();h.plays[0].utc+=1000;await h.timers.at(-1).callback();await none(b);
 b=choice();const original=h.player.timing;h.player.timing=()=>({...original(),ranges:[[25,30]]});await none(b);h.player.timing=original;
 b=choice();h.player.movable=false;await none(b);assert.equal(h.$('apply').disabled,true,'paused, held or restoring output cannot seek');h.player.movable=true;
 b=choice();h.ui.stop();await none(b);h.start();await none(b);
 await tick();b=choice();Object.defineProperty(h.w.document,'visibilityState',{value:'hidden',configurable:true});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));await none(b);
});
test('with no timing source the clock form stays visible but disabled, directly below the source choice',async t=>{
 const h=harness(t,{timingSource:''});h.start();await tick();
 assert.equal(h.$('clock-form').hidden,false);assert.equal(h.$('clock-fields').disabled,true);assert.equal(h.$('apply').disabled,true);
 assert.ok(h.$('timing-source').compareDocumentPosition(h.$('clock-form'))&h.w.Node.DOCUMENT_POSITION_FOLLOWING);
 assert.equal(h.$('timing-source').value,'','no source is chosen for the listener');
 h.$('timing-source').value='gateway';h.$('timing-source').dispatchEvent(new h.w.Event('change'));await tick();
 assert.equal(h.$('clock-fields').disabled,false);assert.equal(h.$('apply').disabled,false);
});
test('only an explicit unsupported answer hides the clock form; failed or stale lookups keep it visible',async t=>{
 const unsupported=harness(t,{unlisted:true});unsupported.start();await tick();
 assert.equal(unsupported.$('clock-form').hidden,true);assert.match(unsupported.$('mapping-note').textContent,/isn’t available for this school/);
 assert.equal(unsupported.$('timing-source').hidden,false,'source choice stays reachable');
 const failed=harness(t,{failSchedule:true});failed.start();await tick();
 assert.equal(failed.$('clock-form').hidden,false);assert.equal(failed.$('clock-fields').disabled,true);assert.equal(failed.$('timing-retry').hidden,false);
 const stale=harness(t,{ageMs:44000,requestMs:1000});stale.start();await tick();
 assert.equal(stale.$('clock-form').hidden,false);assert.equal(stale.$('clock-fields').disabled,true);
});
test('a valid target is offered without an audible timestamp, which is shown as unavailable rather than guessed',async t=>{
 const h=harness(t);h.player.timing=()=>({utc:NaN,position:NaN,ranges:[[0,30]],spans:[{utc:h.plays[0].utc-10000,position:0,duration:30}]});h.start();await tick();
 assert.equal(h.$('apply').disabled,false);assert.equal(h.$('audio-time').textContent,'Unavailable for the audio you hear now');assert.equal(h.$('mapped').textContent,'No matching play anchor');
 h.$('clock').value='10:00';h.submit();h.$('matches').children[0].click();await tick();assert.deepEqual(h.seeks,[10]);
});
test('an unconfirmed move reports it honestly and never claims the play was reached',async t=>{
 const h=harness(t,{seekResult:'failed'});h.start();await tick();h.$('clock').value='10:00';h.submit();h.$('matches').children[0].click();await tick();
 assert.equal(h.$('result').textContent,'The move to that play could not be confirmed. Check the audio against your TV and adjust manually.');
});
test('invalidated play choices take their invitation with them; newer move feedback stays',async t=>{
 const h=harness(t,{duplicate:true});h.start();await tick();h.$('clock').value='10:00';
 h.submit();assert.match(h.$('result').textContent,/Several plays match/);const stale=h.$('matches').children[0];
 await h.timers.at(-1).callback();
 assert.equal(h.$('matches').children.length,0);assert.equal(h.$('result').textContent,'','a refreshed snapshot removes the stale invitation');
 stale.click();await tick();assert.equal(h.seeks.length,0,'the stale choice cannot seek');assert.match(h.$('result').textContent,/no longer/);
 h.submit();h.$('offset').value='1';h.$('offset').dispatchEvent(new h.w.Event('input'));assert.equal(h.$('result').textContent,'','an offset change clears it too');
 h.submit();h.ui.invalidate();assert.equal(h.$('result').textContent,'','recovery clears it too');
 h.submit();h.$('matches').children[0].click();await tick();assert.match(h.$('result').textContent,/Moved to recorded play/);
 await h.timers.at(-1).callback();assert.match(h.$('result').textContent,/Moved to recorded play/,'move feedback survives invalidation');
 h.$('clock').value='12:00';h.submit();assert.match(h.$('result').textContent,/outside/);h.$('offset').dispatchEvent(new h.w.Event('input'));assert.match(h.$('result').textContent,/outside/,'an error is not an invitation');
});
const seekGate=h=>({form:h.$('clock-form').hidden,fields:h.$('clock-fields').disabled,apply:h.$('apply').disabled,retry:h.$('timing-retry').hidden});
test('gateway timing with unknown age keeps the clock form visible but disabled and Retry reachable',async t=>{
 const h=harness(t,{ageMs:null});h.start();await tick();
 assert.deepEqual(seekGate(h),{form:false,fields:true,apply:true,retry:false});
});
test('stale gateway timing keeps the clock form visible but disabled and Retry reachable',async t=>{
 const h=harness(t,{ageMs:44000,requestMs:1000});h.start();await tick();
 assert.deepEqual(seekGate(h),{form:false,fields:true,apply:true,retry:false});
});
test('fresh gateway timing that ages to stale offers Retry; a valid retry restores seeking without moving audio',async t=>{
 const h=harness(t);h.start();await tick();
 assert.deepEqual(seekGate(h),{form:false,fields:false,apply:false,retry:true});
 h.advance(45000);h.$('offset').dispatchEvent(new h.w.Event('input'));
 assert.deepEqual(seekGate(h),{form:false,fields:true,apply:true,retry:false});
 const polls=h.timers.filter(x=>!x.cancelled).length;
 h.$('timing-retry').click();await tick();
 assert.deepEqual(seekGate(h),{form:false,fields:false,apply:false,retry:true});
 assert.equal(h.seeks.length,0,'retry never touches audio');
 assert.equal(h.timers.filter(x=>!x.cancelled).length,polls,'the old poll is replaced, not duplicated');
});
test('browser historical timing with unknown freshness keeps confirmed seeking and no Retry warning',async t=>{
 const h=harness(t,{timingSource:'browser',ageMs:null});h.start();await tick();
 h.advance(45000);h.$('offset').dispatchEvent(new h.w.Event('input'));
 assert.deepEqual(seekGate(h),{form:false,fields:false,apply:false,retry:true});
});
test('recovery clears old play choices without losing calibration or timing source',async t=>{
 const h=harness(t,{timingSource:'browser',ageMs:null});h.start();await tick();
 h.$('offset').value='3';h.$('offset').dispatchEvent(new h.w.Event('input'));h.$('clock').value='10:00';h.submit();
 const old=h.$('matches').children[0];assert.ok(old);
 h.ui.invalidate();
 assert.equal(h.$('matches').children.length,0);
 old.click();await tick();assert.equal(h.seeks.length,0);assert.match(h.$('result').textContent,/no longer/);
 assert.equal(h.$('offset').value,'3');assert.equal(h.$('timing-source').value,'browser');
 h.submit();h.$('matches').children[0].click();await tick();assert.deepEqual(h.seeks,[13]);
 h.ui.reset();assert.equal(h.$('offset').value,'0','a cross-source reset drops calibration');
});
