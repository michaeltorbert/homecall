import { metadataURL, mediaURL } from '../src/gateway.js';
import { defaultGame } from '../src/game-choice.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../src/homestream-ui.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export function/g,'function');
const tick=()=>new Promise(r=>setImmediate(r));
// Timers are recorded, never real: the initial status deadline fires only when a test fires it.
function harness(t,{read,probe,gateway='https://gateway.example',hooks={}}={}){
 const dom=new JSDOM('<section id="game-panel"><select id="game"></select><p id="game-note"></p><button id="game-refresh"></button></section>',{url:'https://example.test/homecall/',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window,timers=[];w.AbortController=AbortController;w.metadataURL=metadataURL;w.mediaURL=mediaURL;w.defaultGame=defaultGame;w.__GATEWAY_ORIGIN__=gateway;w.readJSON=read;w.checkPlaylist=probe;
 w.setTimeout=(fn,ms)=>{const timer={fn,ms,cancelled:false};timers.push(timer);return timer;};w.clearTimeout=timer=>{if(timer)timer.cancelled=true;};
 w.eval(source+';window.setup=setupHomestream;');
 let stopped=0,rendered=0;const ui=w.setup({onChange:()=>{stopped++},onReady:()=>{rendered++},...hooks});
 return{ui,w,timers,$:id=>w.document.getElementById(id),get stopped(){return stopped},get rendered(){return rendered}};
}
// 'now' kicks off a minute from now, so it is the next upcoming game by catalog time.
const games=[{id:'now',start:Date.now()+60000,url:'https://gateway.example/media/game/team-id/now',opponent:'Tennessee'},{id:'future',start:Date.now()+604800000,url:null,opponent:'Mercer'}];
const reader=async url=>url.pathname.endsWith('/teams')?[{id:'team-id',name:'Georgia Tech'}]:games;
test('discovery enables only advancing feed; unpublished selection stops playback and disables readiness',async t=>{
 const h=harness(t,{read:reader,probe:async()=> 'ready'});h.ui.setEnabled(true);await tick();
 assert.equal(h.ui.ready.id,'now');assert.match(h.$('game-note').textContent,/Live playlist/);
 h.$('game').value='future';await h.$('game').onchange();assert.equal(h.ui.ready,null);assert.match(h.$('game-note').textContent,/not been published/);assert.equal(h.stopped,2);
});
test('switching teams cancels slow discovery; late result cannot enable old feed',async t=>{
 let resolve;const h=harness(t,{read:()=>new Promise(r=>resolve=r),probe:async()=> 'ready'});h.ui.setEnabled(true);h.ui.setEnabled(false);resolve([{id:'gt',name:'Georgia Tech'}]);await tick();
 assert.equal(h.ui.ready,null);assert.equal(h.$('game-panel').hidden,true);assert.equal(h.rendered,0);
});
test('refresh re-fetches exact addresses and blocks old source while catalog is unavailable',async t=>{
 let fail=false;const h=harness(t,{read:async u=>{if(fail)throw Error();return reader(u)},probe:async()=> 'ready'});
 h.ui.setEnabled(true);await tick();assert.ok(h.ui.ready);fail=true;await h.ui.refresh();assert.equal(h.ui.ready,null);assert.match(h.$('game-note').textContent,/catalog could not load/);assert.equal(h.$('game-refresh').disabled,false);
});

test('focused manual refresh restores its enabled button after success and catalog failure',async t=>{
 let fail=false;const h=harness(t,{read:async u=>{if(fail)throw Error('fixture failure');return reader(u);},probe:async()=> 'ready'});
 h.ui.setEnabled(true);await tick();
 const button=h.$('game-refresh');button.getClientRects=()=>[{width:80,height:24}];
 for(const shouldFail of [false,true]){
  fail=shouldFail;let active=button;
  Object.defineProperty(h.w.document,'activeElement',{configurable:true,get:()=>active});
  button.focus=()=>{active=button;};assert.equal(h.w.document.activeElement,button);
  button.onclick();active=h.w.document.body;await tick();
  assert.equal(button.disabled,false);assert.equal(h.w.document.activeElement,button,shouldFail?'failure restores browser-lost focus':'success restores browser-lost focus');
 }
});

test('manual refresh does not reclaim focus after the user moves while its catalog read is pending',async t=>{
 let deferred=null,hold=false;
 const h=harness(t,{read:u=>hold?new Promise((resolve,reject)=>{deferred={resolve,reject,url:u};}):reader(u),probe:async()=> 'ready'});
 h.ui.setEnabled(true);await tick();
 const button=h.$('game-refresh'),away=h.w.document.createElement('button');away.textContent='Other action';h.$('game-panel').append(away);
 button.getClientRects=()=>[{width:80,height:24}];hold=true;button.focus();button.onclick();
 assert.equal(button.disabled,true);away.focus();away.blur();assert.equal(h.w.document.activeElement,h.w.document.body,'the user can move focus away and then to the document body');
 deferred.resolve([{id:'team-id',name:'Georgia Tech'}]);await tick();deferred.resolve(games);await tick();
 assert.equal(button.disabled,false);assert.equal(h.w.document.activeElement,h.w.document.body,'later focus movement wins over the old refresh intent');
});

test('stopping an in-flight focused refresh cancels its pending focus restoration',async t=>{
 let finish;const h=harness(t,{read:u=>new Promise(resolve=>{finish=()=>resolve(u.pathname.endsWith('/teams')?[{id:'team-id',name:'Georgia Tech'}]:games);}),probe:async()=> 'ready'});
 h.ui.setEnabled(true);await tick();
 // Complete the initial request separately; only the explicit refresh is held below.
 finish();await tick();finish();await tick();
 const button=h.$('game-refresh');button.getClientRects=()=>[{width:80,height:24}];
 let active=button;Object.defineProperty(h.w.document,'activeElement',{configurable:true,get:()=>active});button.focus=()=>{active=button;};
 button.onclick();active=h.w.document.body;h.ui.stop();finish();await tick();
 assert.equal(button.disabled,false);assert.equal(h.w.document.activeElement,h.w.document.body);
});

test('initial automatic discovery never claims Refresh focus',async t=>{
 const h=harness(t,{read:reader,probe:async()=> 'ready'});const button=h.$('game-refresh');
 button.getClientRects=()=>[{width:80,height:24}];h.ui.setEnabled(true);await tick();
 assert.equal(button.disabled,false);assert.notEqual(h.w.document.activeElement,button);
 await h.ui.refresh();assert.notEqual(h.w.document.activeElement,button,'an unfocused programmatic refresh does not claim focus');
});

test('Homestream discovery sends both metadata requests to the configured gateway and media probes use the relay',async t=>{
 const requests=[],probes=[];const h=harness(t,{gateway:'https://gateway.example',read:async url=>{requests.push(url.href);return reader(url);},probe:async url=>{probes.push(url);return 'ready';}});
 h.ui.setEnabled(true);await tick();assert.deepEqual(requests,['https://gateway.example/api/homestream/teams','https://gateway.example/api/homestream/games/team-id']);assert.deepEqual(probes,[games[0].url]);
});

const plain=value=>JSON.parse(JSON.stringify(value));
const texts=h=>[...h.$('game').options].map(o=>o.textContent);
// Deliberate change (issue #39): onGames now starts status polling before the default is chosen, so at
// that moment the Game choice is the neutral placeholder rather than an already selected game.
test('onGames receives every game after options are built, before the default choice and the feed probe; a kept choice is restored first',async t=>{
 const seen=[];let atProbe,finishProbe,probes=0,h;
 h=harness(t,{read:reader,probe:()=>{probes++;atProbe={calls:seen.length,value:h.$('game').value};return new Promise(r=>finishProbe=r);},hooks:{onGames:(list,meta)=>seen.push(plain({list,meta,value:h.$('game').value,options:texts(h)}))}});
 h.ui.setEnabled(true);await tick();
 assert.equal(seen.length,1);assert.deepEqual(atProbe,{calls:1,value:'now'});
 assert.deepEqual(seen[0].list,games.map(({id,opponent,start})=>({id,opponent,start})));assert.deepEqual(seen[0].meta,{teamId:'team-id'});
 assert.equal(seen[0].value,'');assert.deepEqual(seen[0].options.slice(0,1),['Finding the live or next game…']);assert.equal(seen[0].options.length,3);assert.match(seen[0].options[2],/feed not published$/);
 assert.deepEqual(texts(h).length,2,'the placeholder leaves once a game is chosen');
 finishProbe('ready');await tick();assert.equal(h.ui.ready.id,'now');assert.equal(probes,1);
 h.ui.refresh();await tick();assert.equal(seen.length,2);assert.equal(seen[1].value,'now','an explicit refresh restores the kept game before onGames');
 assert.deepEqual(atProbe,{calls:2,value:'now'});finishProbe('ready');await tick();assert.equal(probes,2);
});
test('relabel changes option text only: value, order, selection, disabled state, focus, readiness and probes are untouched',async t=>{
 let probes=0,finishProbe;const h=harness(t,{read:reader,probe:()=>{probes++;return new Promise(r=>finishProbe=r);}});
 h.ui.setEnabled(true);await tick();
 const base=texts(h);
 const snapshot=()=>({values:[...h.$('game').options].map(o=>o.value),selected:h.$('game').selectedIndex,value:h.$('game').value,disabled:h.$('game').disabled,refresh:h.$('game-refresh').disabled,focus:h.w.document.activeElement===h.$('game'),ready:h.ui.ready,stopped:h.stopped,rendered:h.rendered,probes,note:h.$('game-note').textContent});
 const before=snapshot();
 h.ui.relabel(new Map([['now','LIVE'],['future','Upcoming']]));
 assert.deepEqual(texts(h),[`LIVE · ${base[0]}`,`Upcoming · ${base[1]}`]);assert.deepEqual(snapshot(),before);
 h.ui.relabel(new Map([['now','Completed'],['future','Status unavailable']]));
 assert.deepEqual(texts(h),[`Completed · ${base[0]}`,`Status unavailable · ${base[1]}`],'prefixes replace, never accumulate');
 h.ui.relabel(new Map());assert.deepEqual(texts(h),base);assert.deepEqual(snapshot(),before);
 finishProbe('ready');await tick();assert.equal(h.ui.ready.id,'now');
 h.$('game').focus();const ready=snapshot();assert.equal(ready.focus,true);assert.equal(ready.disabled,false);
 h.ui.relabel(new Map([['now','LIVE']]));assert.deepEqual(snapshot(),ready);assert.equal(h.ui.ready.id,'now');
});
// Issue #44: kickoff wording from published confidence only. Times are not inferred from their value.
test('kickoff labels: confirmed keeps the catalog time, TBD shows the catalog date, all else is unconfirmed; a manual choice and controls are untouched',async t=>{
 const when=start=>new Date(start).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 const day=utc=>new Date(utc).toLocaleDateString([],{month:'short',day:'numeric',timeZone:'UTC'});
 const catalog=[
  {id:'unc',opponent:'North Carolina',start:Date.parse('2026-10-17T19:30:00Z'),date:'2026-10-17',url:null},
  {id:'bc',opponent:'Boston',start:Date.parse('2026-10-31T16:34:00Z'),date:'2026-10-31',url:null},
  // A late Saturday kickoff whose UTC start falls on Sunday: the TBD date must stay the catalog Saturday.
  {id:'late',opponent:'Miami',start:Date.parse('2026-11-15T03:30:00Z'),date:'2026-11-14',url:null},
  {id:'bad',opponent:'Wake Forest',start:Date.parse('2026-11-28T17:00:00Z'),date:'2026-02-30',url:null},
  {id:'wm',opponent:'William & Mary',start:Date.parse('2026-09-26T19:30:00Z'),date:'2026-09-26',url:'https://gateway.example/media/game/team-id/wm'}];
 let probes=0;
 const h=harness(t,{read:async u=>u.pathname.endsWith('/teams')?[{id:'team-id',name:'Georgia Tech'}]:catalog,probe:async()=>{probes++;return 'ready';}});
 h.ui.setEnabled(true);await tick();
 const labels=()=>[...h.$('game').options].filter(o=>o.value).map(o=>o.textContent);
 // The warning precedes the time so a narrow closed select cannot show a bare time (390 px pixel finding).
 const unconfirmed=catalog.map(g=>`Unconfirmed time: ${when(g.start)} · vs ${g.opponent}${g.url?'':' · feed not published'}`);
 assert.deepEqual(labels(),unconfirmed,'before any status every catalog time is unconfirmed');
 h.$('game').value='wm';await h.$('game').onchange();h.$('game').focus();
 const snapshot=()=>({values:[...h.$('game').options].map(o=>o.value),value:h.$('game').value,disabled:h.$('game').disabled,refresh:h.$('game-refresh').disabled,focus:h.w.document.activeElement===h.$('game'),ready:h.ui.ready?.id,stopped:h.stopped,rendered:h.rendered,probes,note:h.$('game-note').textContent});
 const before=snapshot();assert.deepEqual([before.value,before.ready,before.focus],['wm','wm',true]);
 h.ui.relabel(new Map([['bc','Upcoming'],['wm','Completed']]),new Map([['unc','confirmed'],['bc','tbd'],['late','tbd'],['bad','tbd'],['wm','provisional']]));
 assert.deepEqual(labels(),[`${when(catalog[0].start)} · vs North Carolina · feed not published`,`Upcoming · ${day(Date.UTC(2026,9,31))}, Time TBD · vs Boston · feed not published`,
  `${day(Date.UTC(2026,10,14))}, Time TBD · vs Miami · feed not published`,'Date pending, Time TBD · vs Wake Forest · feed not published',`Completed · ${unconfirmed[4]}`]);
 assert.notEqual(day(Date.UTC(2026,10,14)),day(catalog[2].start),'the TBD date is the catalog date, not the start');
 assert.deepEqual(snapshot(),before);
 h.ui.relabel(new Map(),new Map());assert.deepEqual(labels(),unconfirmed,'missing or stale confidence reverts to unconfirmed');
 h.ui.relabel(new Map([['bc','Status unavailable']]));assert.equal(labels()[1],`Status unavailable · ${unconfirmed[1]}`,'a one-argument update reads as unconfirmed');
 assert.deepEqual(snapshot(),before);
});
test('catalog refresh, failure and disabling invalidate labels; replaced options and throwing hooks are isolated',async t=>{
 let invalidations=0,gamesCalls=0,fail=false;
 const h=harness(t,{read:async u=>{if(fail)throw Error();return reader(u);},probe:async()=> 'ready',hooks:{onGames(){gamesCalls++;throw Error('label consumer');},onCatalogInvalidated(){invalidations++;throw Error('label consumer');}}});
 h.ui.setEnabled(true);await tick();
 assert.equal(h.ui.ready.id,'now','throwing hooks never block readiness');assert.equal(gamesCalls,1);const enabled=invalidations;assert.ok(enabled>=1);
 const oldOption=h.$('game').options[0];h.ui.relabel(new Map([['now','LIVE']]));
 await h.ui.refresh();assert.equal(invalidations,enabled+1);assert.equal(gamesCalls,2);
 assert.ok(!texts(h)[0].startsWith('LIVE'),'a replaced catalog starts from its own base labels');
 h.ui.relabel(new Map([['now','Upcoming']]));assert.equal(oldOption.textContent.startsWith('LIVE · '),true,'detached options are never relabeled');
 fail=true;await h.ui.refresh();assert.equal(invalidations,enabled+2);assert.equal(gamesCalls,2);
 h.ui.setEnabled(false);assert.equal(invalidations,enabled+3);
});

test('an explicit catalog ID wins over names, status reports checking before readiness, and onChange says why',async t=>{
 const kinds=[];let finish;const h=harness(t,{read:async url=>url.pathname.endsWith('/teams')?[{id:'other-id',name:'Georgia Tech'},{id:'team-id',name:'Renamed school'}]:games,
  probe:()=>new Promise(r=>finish=r),hooks:{teamId:()=> 'team-id',onChange:kind=>kinds.push(kind)}});
 assert.equal(h.ui.status,'idle');h.ui.setEnabled(true);assert.equal(h.ui.status,'loading');await tick();
 assert.equal(h.ui.status,'checking');assert.equal(h.ui.ready,null);finish('ready');await tick();
 assert.equal(h.ui.status,'ready');assert.equal(h.ui.ready.id,'now');assert.match(h.ui.ready.url,/\/team-id\/now$/);
 h.$('game').value='future';await h.$('game').onchange();assert.equal(h.ui.status,'unavailable');assert.deepEqual(kinds,['refresh','game']);
 const missing=harness(t,{read:async url=>url.pathname.endsWith('/teams')?[{id:'other-id',name:'Georgia Tech'}]:games,probe:async()=> 'ready',hooks:{teamId:()=> 'team-id'}});
 missing.ui.setEnabled(true);await tick();assert.equal(missing.ui.status,'unavailable');assert.match(missing.$('game-note').textContent,/No Georgia Tech game feeds are listed/);
});
// ---------- Default game (issue #39): one bounded status round, owner veto, retention ----------
const HOUR=3600000,DAY=24*HOUR,T0=Date.now();
const media=(team,id)=>`https://gateway.example/media/game/${team}/${id}`;
// past: completed last week; live: started an hour ago; next: tomorrow, unpublished; later: next week.
const slate=(team='team-a')=>[{id:'past',start:T0-7*DAY,url:media(team,'past'),opponent:'Clemson'},{id:'live',start:T0-HOUR,url:media(team,'live'),opponent:'Tulane'},
 {id:'next',start:T0+DAY,url:null,opponent:'Mercer'},{id:'later',start:T0+7*DAY,url:media(team,'later'),opponent:'Furman'}];
function chooser(t,{lists={'team-a':slate('team-a')},hooks={}}={}){
 const calls=[],probes=[];let team='team-a',owner=0,free=true;
 const read=async url=>{const path=url.pathname;if(path.endsWith('/homestream/teams'))return Object.keys(lists).map(id=>({id,name:id}));return lists[decodeURIComponent(path.split('/').at(-1))];};
 const h=harness(t,{read,probe:async url=>{probes.push(url.split('/').at(-1));return 'ready';},hooks:{teamId:()=>team,school:()=>'Sample',epoch:()=>owner,idle:()=>free,
  statuses:signal=>{const d={signal};d.promise=new Promise(r=>{d.resolve=r;});calls.push(d);return d.promise;},...hooks}});
 return Object.assign(h,{calls,probes,lists,setTeam(id){team=id;},bump(){owner++;},setIdle(v){free=v;},
  deadline:()=>h.timers.filter(x=>x.ms===4000&&!x.cancelled),values:()=>[...h.$('game').options].map(o=>o.value),
  view:()=>({value:h.$('game').value,game:h.$('game').disabled,refresh:h.$('game-refresh').disabled,status:h.ui.status,note:h.$('game-note').textContent,probes:[...probes],stopped:h.stopped,rendered:h.rendered,ready:h.ui.ready?.id??null})});
}
const S=entries=>new Map(Object.entries(entries));
test('the default waits for one status round with a neutral, enabled Game and a disabled Refresh; a unique LIVE wins without onChange',async t=>{
 const h=chooser(t);h.ui.setEnabled(true);await tick();
 const option=h.$('game').options[0];
 assert.deepEqual([option.value,option.disabled,option.textContent],['',true,'Finding the live or next game…']);
 assert.deepEqual(h.view(),{value:'',game:false,refresh:true,status:'loading',note:'Finding the live or next Sample game…',probes:[],stopped:1,rendered:0,ready:null});
 assert.equal(h.calls.length,1);assert.equal(h.deadline().length,1,'one 4-second deadline');
 h.calls[0].resolve(S({past:'completed',live:'live',next:'upcoming',later:'upcoming'}));await tick();
 assert.deepEqual(h.view(),{value:'live',game:false,refresh:false,status:'ready',note:'Live playlist confirmed. Press Play, then match the audio to your TV.',probes:['live'],stopped:1,rendered:1,ready:'live'});
 assert.deepEqual(h.values(),['past','live','next','later'],'the placeholder is gone; every game stays selectable');
 assert.equal(h.deadline().length,0,'the deadline is cleared');
});
test('the 4-second deadline settles an abort-insensitive status hook; the late result can never reselect',async t=>{
 const h=chooser(t);h.ui.setEnabled(true);await tick();
 const [deadline]=h.deadline();assert.equal(deadline.ms,4000);deadline.fn();await tick();
 assert.equal(h.$('game').value,'next','with no status the next kickoff is chosen; LIVE is never inferred from the clock');
 assert.equal(h.$('game-note').textContent,'Live status could not be confirmed for the most recent game. This game’s feed has not been published. Refresh closer to the broadcast.');
 assert.deepEqual([h.ui.status,h.ui.ready,h.$('game-refresh').disabled],['unavailable',null,false]);
 const before=h.view();
 h.calls[0].resolve(S({live:'live'}));await tick();
 assert.deepEqual(h.view(),before,'a late LIVE result is ignored');assert.equal(h.calls.length,1);
});
test('a manual game choice during the wait retires the default and only that choice is probed',async t=>{
 const h=chooser(t);h.ui.setEnabled(true);await tick();
 h.$('game').value='past';await h.$('game').onchange();
 assert.deepEqual(h.view(),{value:'past',game:false,refresh:false,status:'ready',note:'Live playlist confirmed. Press Play, then match the audio to your TV.',probes:['past'],stopped:2,rendered:1,ready:'past'});
 assert.equal(h.calls[0].signal.aborted,true,'the wait is canceled');assert.equal(h.deadline().length,0);
 assert.deepEqual(h.values(),['past','live','next','later']);
 const before=h.view();h.calls[0].resolve(S({live:'live'}));await tick();
 assert.deepEqual(h.view(),before,'no late change, probe, note or readiness');
});
test('an owner veto (any listener action or listening intent) retires the default for good: neutral, no onChange, no probe',async t=>{
 for(const veto of [h=>h.bump(),h=>h.setIdle(false)]){
  const h=chooser(t);h.ui.setEnabled(true);await tick();veto(h);
  h.calls[0].resolve(S({live:'live'}));await tick();
  assert.deepEqual(h.view(),{value:'',game:false,refresh:false,status:'unavailable',note:'Choose a game to check its feed.',probes:[],stopped:1,rendered:1,ready:null});
  assert.equal(h.$('game').options[0].textContent,'Choose a game');
  h.setIdle(true);await tick();assert.equal(h.calls.length,1,'it is not deferred and retried');
  h.ui.refresh();await tick();
  assert.deepEqual([h.$('game').value,h.probes.length,h.calls.length],['',0,1],'an explicit refresh with nothing kept never picks a default');
  assert.equal(h.$('game-note').textContent,'Choose a game to check its feed.');
 }
});
test('neutral outcomes say why: several LIVE, all completed, unconfirmed, nothing listed',async t=>{
 const cases=[[slate(),{live:'live',later:'live'},'More than one Sample game is reported LIVE. Choose a game.'],
  [slate().slice(0,2),{past:'completed',live:'completed'},'No live or upcoming Sample games are listed. Choose a past game to check its feed.'],
  [slate().slice(0,2),{past:'unavailable',live:'completed'},'No live or upcoming Sample game could be confirmed. Choose a listed game.'],
  [[...slate().slice(0,2),{id:'tbd',start:null,date:'TBA',url:null,opponent:'Mercer'}],{past:'completed',live:'completed'},'No live or upcoming Sample game could be confirmed. Choose a listed game.']];
 for(const [list,statuses,note] of cases){
  const h=chooser(t,{lists:{'team-a':list}});h.ui.setEnabled(true);await tick();h.calls[0].resolve(S(statuses));await tick();
  assert.deepEqual([h.$('game').value,h.$('game-note').textContent,h.ui.status,h.probes.length,h.stopped],['',note,'unavailable',0,1],note);
  assert.deepEqual(h.values(),['',...list.map(g=>g.id)],'every listed game stays selectable');
 }
 const empty=chooser(t,{lists:{'team-a':[]}});empty.ui.setEnabled(true);await tick();
 assert.deepEqual([empty.$('game-note').textContent,empty.ui.status,empty.calls.length],['No Sample football games are listed. Refresh later.','unavailable',0]);
});
test('Refresh keeps the explicit same-team choice, even a past game while another is LIVE, without a status wait; a withdrawn choice is never replaced',async t=>{
 const h=chooser(t);h.ui.setEnabled(true);await tick();h.calls[0].resolve(S({live:'live'}));await tick();
 h.$('game').value='past';await h.$('game').onchange();
 await h.ui.refresh();
 assert.deepEqual([h.$('game').value,h.probes.at(-1),h.calls.length,h.deadline().length],['past','past',1,0]);
 h.lists['team-a']=slate().filter(g=>g.id!=='past');await h.ui.refresh();
 assert.deepEqual([h.$('game').value,h.$('game-note').textContent,h.ui.status,h.ui.ready,h.calls.length],['','The game you chose is no longer listed. Choose a listed game.','unavailable',null,1]);
 assert.equal(h.probes.at(-1),'past','nothing else is probed');
});
test('re-enabling the same school keeps its game; another school sharing the game IDs gets its own default',async t=>{
 const h=chooser(t,{lists:{'team-a':slate('team-a'),'team-b':slate('team-b')}});
 h.ui.setEnabled(true);await tick();h.calls[0].resolve(S({}));await tick();
 h.$('game').value='past';await h.$('game').onchange();
 h.ui.setEnabled(true);await tick();assert.deepEqual([h.$('game').value,h.calls.length],['past',1],'same school: kept');
 h.ui.setEnabled(false);h.setTeam('team-b');h.ui.setEnabled(true);await tick();
 assert.deepEqual([h.$('game').value,h.calls.length],['',2],'another school never inherits past by ID');
 h.calls[1].resolve(S({live:'live'}));await tick();assert.equal(h.$('game').value,'live');assert.equal(h.ui.ready.url,media('team-b','live'));
});
test('disabling or switching away during the wait settles nothing late',async t=>{
 const h=chooser(t);h.ui.setEnabled(true);await tick();
 h.ui.setEnabled(false);assert.equal(h.calls[0].signal.aborted,true);
 h.calls[0].resolve(S({live:'live'}));for(const timer of h.timers)timer.fn();await tick();
 assert.deepEqual([h.probes.length,h.rendered,h.$('game-panel').hidden],[0,0,true]);
});
test('cross-origin and mismatched game media never reach the probe or Play readiness', async t => {
 for (const url of ['https://upstream.example/live.m3u8','https://gateway.example/media/game/team-id/other','https://gateway.example/media/game/team-id/now?target=private']) {
  let probes=0;
  const h=harness(t,{read:async path=>path.pathname.endsWith('/teams')?[{id:'team-id',name:'Georgia Tech'}]:[{...games[0],url}],probe:async()=>{probes++;return 'ready';}});
  h.ui.setEnabled(true);await tick();assert.equal(probes,0);assert.equal(h.ui.ready,null);assert.match(h.$('game-note').textContent,/could not load/);
 }
});
