import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { setupArchive } from '../src/archive.js';
import { setupShell, openDialog } from '../src/ui-shell.js';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const item={id:'one',opponent:'Tulane',sport:'Football',start:'2026-09-05T18:00:00Z',kind:'Game recording',url:'https://gateway.example/media/archive/duke/one'};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t, fetcher, memory, sync, {beforeSetup, ...options}={}) {
  const dom=new JSDOM(html,{url:'https://example.test/homecall/'});
  beforeSetup?.(dom);
  t.mock.method(globalThis,'fetch',fetcher || (async()=>({ok:true,json:async()=>({checkedAt:'2026-09-11T00:00:00Z',schools:{duke:{status:'ready',source:'https://duke.leanplayer.com/',items:[item]},miami:{status:'external',source:'https://miamihurricanes.com/',items:[]},vt:{status:'ready',source:'https://hokiesports.com/',items:[]}}})})));
  const oldDocument=globalThis.document,oldOption=globalThis.Option;
  globalThis.document=dom.window.document; globalThis.Option=dom.window.Option;
  t.after(()=>{globalThis.document=oldDocument;globalThis.Option=oldOption;dom.window.close();});
  const $=id=>document.getElementById(id), audio=$('replay-audio');
  let stops=0,paused=0,loads=0,plays=0;
  audio.pause=()=>{paused++;}; audio.load=()=>{loads++;};audio.play=async()=>{plays++;};
  const nav=setupArchive({stopLive:()=>{stops++;},selectedTeam:()=> 'duke',memory,sync,origin:"https://gateway.example",...options});
  return {$,audio,nav,counts:()=>({stops,paused,loads,plays}),dom,prompt:()=>$('confirm-dialog').hasAttribute('open'),proceed:()=>$('confirm-continue').click(),dismiss:()=>$('confirm-cancel').click()};
}
test('archive keeps live audio across tabs, stops it when a recording starts, supports playback, filters and unloads when leaving or changing school',async t=>{
  const h=harness(t);await settle();
  h.$('archive-tab').click();
  assert.equal(h.counts().stops,0);assert.equal(h.$('live-panel').hidden,true);
  assert.equal(h.$('archive-panel').hidden,false);assert.equal(h.$('archive-list').children.length,1);
  h.$('archive-list').querySelector('button').click();await settle();
  assert.equal(h.counts().stops,1);
  assert.equal(h.audio.src,item.url);assert.equal(h.counts().plays,1);
  assert.equal(h.$('replay-player').hidden,false);
  h.$('archive-team').value='miami';h.$('archive-team').onchange();assert.equal(h.prompt(),true);h.proceed();
  assert.equal(h.audio.hasAttribute('src'),false);assert.equal(h.$('replay-player').hidden,true);
  assert.match(h.$('archive-note').textContent,/aren’t available/);
  h.$('listen-tab').click();assert.equal(h.$('live-panel').hidden,false);
  assert.equal(h.$('archive-panel').hidden,true);
});
test('keyboard tabs move focus and published catalog failure can retry',async t=>{
  let attempts=0;
  const h=harness(t,async()=>{attempts++;throw Error('offline');});await settle();
  assert.match(h.$('archive-note').textContent,/could not load/);
  h.$('listen-tab').dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.equal(document.activeElement.id,'archive-tab');
  assert.match(h.$('archive-note').textContent,/could not load/);
  h.$('archive-retry').click();await settle();assert.equal(attempts,2);
  assert.equal(h.$('archive-retry').disabled,false);
});
test('late rejected play cannot replace newer recording status',async t=>{
  const h=harness(t);await settle();h.$('archive-tab').click();
  let reject;
  h.audio.play=()=>new Promise((_,r)=>{reject=r;});
  h.$('archive-list').querySelector('button').click();
  h.$('archive-team').value='miami';h.$('archive-team').onchange();h.proceed();
  h.$('replay-status').textContent='new status';reject(Error('old'));await settle();
  assert.equal(h.$('replay-status').textContent,'new status');
});

test('same recording retries, resume and hold ignore stale play failures; selected tab is a no-op',async t=>{
  const h=harness(t);await settle();h.$('archive-tab').click();
  const failures=[];h.audio.play=()=>new Promise((_,reject)=>failures.push(reject));
  const button=h.$('archive-list').querySelector('button');
  button.click();button.click();h.proceed();h.$('replay-status').textContent='new playback';
  failures[0](Error('old request'));await settle();assert.equal(h.$('replay-status').textContent,'new playback');
  const before=h.counts();h.$('archive-tab').click();assert.deepEqual(h.counts(),before);
  assert.equal(h.audio.src,item.url);
  h.$('replay-resume').click();button.click();h.proceed();h.$('replay-status').textContent='another recording';
  failures[2](Error('old resume'));await settle();assert.equal(h.$('replay-status').textContent,'another recording');
  h.$('replay-hold').click();failures[3](Error('interrupted by pause'));await settle();
  assert.match(h.$('replay-status').textContent,/paused at the play/);
});
test('refresh preserves playback and filters; leaving for Listen confirms, then stops playback; Home and End navigate',async t=>{
  const h=harness(t);await settle();h.$('archive-tab').click();
  h.$('archive-sport').value='Football';h.$('archive-sport').onchange();
  h.$('archive-list').querySelector('button').click();
  Object.defineProperty(h.audio,'currentTime',{value:42,writable:true});
  const before=h.counts();h.$('archive-retry').click();await settle();
  assert.deepEqual(h.counts(),before);assert.equal(h.audio.currentTime,42);assert.equal(h.$('archive-sport').value,'Football');
  h.$('listen-tab').click();assert.equal(h.prompt(),true);assert.equal(h.audio.src,item.url,'nothing unloads before Continue');
  h.proceed();assert.equal(h.audio.hasAttribute('src'),false);assert.equal(h.$('replay-player').hidden,true);assert.equal(h.$('live-panel').hidden,false);
  h.$('listen-tab').dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'End'}));assert.equal(document.activeElement.id,'archive-tab');
  h.$('archive-tab').dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'Home'}));assert.equal(document.activeElement.id,'listen-tab');
});
test('malformed catalog is rejected before becoming active and school changes remain usable',async t=>{
  const h=harness(t,async()=>({ok:true,json:async()=>({checkedAt:'2026-09-11',schools:{duke:{status:'ready',source:'https://duke.leanplayer.com/',items:[{...item,start:null}]}}})}));
  await settle();h.$('archive-tab').click();assert.match(h.$('archive-note').textContent,/could not load/);
  h.$('archive-team').value='miami';assert.doesNotThrow(()=>h.$('archive-team').onchange());
});

test('replay restores after metadata and saves before unloading without overwriting an unloaded bookmark',async t=>{
 const saved=[];const memory={read:()=>({value:125}),save:(...args)=>saved.push(args)};
 const h=harness(t,undefined,memory);await settle();h.$('archive-tab').click();h.$('archive-list').querySelector('button').click();
 h.audio.dispatchEvent(new h.dom.window.Event('timeupdate'));assert.equal(saved.length,0);
 Object.defineProperty(h.audio,'duration',{value:1000,configurable:true});Object.defineProperty(h.audio,'readyState',{value:1});
 h.audio.dispatchEvent(new h.dom.window.Event('loadedmetadata'));assert.equal(h.audio.currentTime,125);h.audio.dispatchEvent(new h.dom.window.Event('playing'));
 h.audio.currentTime=145;h.$('listen-tab').click();h.proceed();assert.deepEqual(saved.at(-1),['replay','duke:one',145]);
 h.audio.currentTime=0;h.audio.dispatchEvent(new h.dom.window.Event('timeupdate'));assert.equal(saved.length,1);
});

test('replay bookmark survives a browser resetting the first seek before playing',async t=>{
 const saved=[];const h=harness(t,undefined,{read:()=>({value:125}),save:(...args)=>saved.push(args)});
 await settle();h.$('archive-tab').click();h.$('archive-list').querySelector('button').click();
 Object.defineProperty(h.audio,'duration',{value:1000});Object.defineProperty(h.audio,'readyState',{value:1});
 h.audio.dispatchEvent(new h.dom.window.Event('loadedmetadata'));h.audio.dispatchEvent(new h.dom.window.Event('seeked'));
 h.audio.currentTime=0;h.audio.dispatchEvent(new h.dom.window.Event('timeupdate'));assert.equal(saved.length,0);
 h.audio.dispatchEvent(new h.dom.window.Event('canplay'));assert.equal(h.audio.currentTime,125);
 h.audio.dispatchEvent(new h.dom.window.Event('playing'));h.audio.currentTime=126;h.audio.dispatchEvent(new h.dom.window.Event('timeupdate'));
 assert.deepEqual(saved.at(-1),['replay','duke:one',126]);
});

test('native audio interaction takes ownership from automatic bookmark retries',async t=>{
 const saved=[];const h=harness(t,undefined,{read:()=>({value:125}),save:(...args)=>saved.push(args)});
 await settle();h.$('archive-tab').click();h.$('archive-list').querySelector('button').click();
 Object.defineProperty(h.audio,'duration',{value:1000});Object.defineProperty(h.audio,'readyState',{value:1});
 h.audio.dispatchEvent(new h.dom.window.Event('loadedmetadata'));
 h.audio.dispatchEvent(new h.dom.window.Event('pointerdown'));h.audio.currentTime=300;
 h.audio.dispatchEvent(new h.dom.window.Event('seeked'));h.audio.dispatchEvent(new h.dom.window.Event('canplay'));
 assert.equal(h.audio.currentTime,300);h.audio.dispatchEvent(new h.dom.window.Event('timeupdate'));assert.deepEqual(saved.at(-1),['replay','duke:one',300]);
});
test('failed bookmark restore resumes saving after actual listening progresses',async t=>{
 const saved=[];const h=harness(t,undefined,{read:()=>({value:125}),save:(...args)=>saved.push(args)});
 await settle();h.$('archive-tab').click();h.$('archive-list').querySelector('button').click();
 Object.defineProperty(h.audio,'duration',{value:1000});Object.defineProperty(h.audio,'readyState',{value:1});Object.defineProperty(h.audio,'paused',{value:false});
 h.audio.dispatchEvent(new h.dom.window.Event('loadedmetadata'));h.audio.currentTime=0;
 h.audio.dispatchEvent(new h.dom.window.Event('canplay'));h.audio.currentTime=0;
 h.audio.dispatchEvent(new h.dom.window.Event('playing'));h.audio.dispatchEvent(new h.dom.window.Event('timeupdate'));assert.equal(saved.length,0);
 h.audio.currentTime=3;h.audio.dispatchEvent(new h.dom.window.Event('timeupdate'));assert.deepEqual(saved.at(-1),['replay','duke:one',3]);
});

test('unknown recording duration cannot block bookmarks after playback progresses',async t=>{
 const saved=[];const h=harness(t,undefined,{read:()=>({value:125}),save:(...args)=>saved.push(args)});
 await settle();h.$('archive-tab').click();h.$('archive-list').querySelector('button').click();
 Object.defineProperty(h.audio,'duration',{value:Infinity});Object.defineProperty(h.audio,'readyState',{value:1});Object.defineProperty(h.audio,'paused',{value:false});
 h.audio.dispatchEvent(new h.dom.window.Event('loadedmetadata'));h.audio.dispatchEvent(new h.dom.window.Event('playing'));
 h.audio.currentTime=3;h.audio.dispatchEvent(new h.dom.window.Event('timeupdate'));assert.deepEqual(saved.at(-1),['replay','duke:one',3]);
});

// Issue #4: stale, overdue and reload-failure notices. Only the note text changes over time.
const CHECKED='2026-09-11T00:00:00.000Z',H=3600_000,M=60_000;
const item2={...item,id:'two',sport:'Basketball',start:'2025-02-01T18:00:00Z',url:'https://gateway.example/media/archive/duke/two'};
const docOf=(schools={},checkedAt=CHECKED)=>({checkedAt,schools:{duke:{status:'ready',source:'https://duke.leanplayer.com/',checkedAt:CHECKED,items:[item,item2]},miami:{status:'external',source:'https://miamihurricanes.com/',items:[]},vt:{status:'ready',source:'https://hokiesports.com/',checkedAt:CHECKED,items:[]},...schools}});
const serve=(...docs)=>{let n=0;return async()=>{const d=docs[Math.min(n++,docs.length-1)];if(d instanceof Error)throw d;return {ok:true,json:async()=>structuredClone(d)};};};
const local=at=>new Date(at).toLocaleString();
function clocked(t,fetcher,start=Date.parse(CHECKED)+H){const clock={now:start,ticks:[]};const h=harness(t,fetcher,undefined,undefined,{now:()=>clock.now,every:fn=>clock.ticks.push(fn)});
  let state='visible';Object.defineProperty(h.dom.window.document,'visibilityState',{configurable:true,get:()=>state});
  return Object.assign(h,{clock,tick:()=>clock.ticks.forEach(fn=>fn()),visibility:value=>{state=value;h.dom.window.document.dispatchEvent(new h.dom.window.Event('visibilitychange'));},school:value=>{h.$('archive-team').value=value;h.$('archive-team').onchange();h.proceed();},note:()=>h.$('archive-note').textContent});}
test('zero-total, filtered-empty, stale-empty, stale, external, unavailable and initial failure notices are distinct',async t=>{
  const h=clocked(t,serve(docOf({vt:{status:'stale',source:'https://hokiesports.com/',checkedAt:CHECKED,items:[]}}),
    docOf({vt:{status:'ready',source:'https://hokiesports.com/',checkedAt:CHECKED,items:[]},duke:{status:'stale',source:'https://duke.leanplayer.com/',checkedAt:CHECKED,items:[item]}}),
    docOf({duke:{status:'unavailable',source:'https://duke.leanplayer.com/',items:[]}})));
  await settle();h.$('archive-tab').click();
  const reload=async()=>{h.$('archive-retry').click();await settle();};
  const notes={initial:'The archive catalog could not load. Try again or visit the official site.'};
  notes.ready=h.note();assert.equal(notes.ready,`2 recordings · Catalog checked ${local(CHECKED)}. Scores are omitted; broadcaster titles may contain spoilers. Recordings may include pregame and postgame audio.`);
  h.$('archive-sport').value='Football';h.$('archive-year').value='2025';h.$('archive-year').onchange();
  notes.filtered=h.note();assert.equal(notes.filtered,`No recordings match these filters. Try another sport or year. Catalog checked ${local(CHECKED)}.`);assert.equal(h.$('archive-list').children.length,0);
  h.school('vt');notes.staleEmpty=h.note();assert.equal(notes.staleEmpty,`The latest refresh failed. The last successful check found no recordings for Virginia Tech. Last checked ${local(CHECKED)}.`);
  h.school('miami');notes.external=h.note();assert.match(notes.external,/aren’t available/);
  await reload();h.school('duke');
  notes.stale=h.note();assert.equal(notes.stale,`Showing previously checked recordings. The latest refresh failed. Last checked ${local(CHECKED)}.`);assert.equal(h.$('archive-list').children.length,1,'stale recordings stay playable');
  h.school('vt');notes.zero=h.note();assert.equal(notes.zero,`No recordings are listed for Virginia Tech. Catalog checked ${local(CHECKED)}.`);
  await reload();h.school('duke');notes.unavailable=h.note();assert.match(notes.unavailable,/couldn’t refresh Duke’s archive/);
  assert.equal(new Set(Object.values(notes)).size,Object.keys(notes).length);
});
test('initial catalog failure keeps its own notice',async t=>{
  const h=clocked(t,serve(Error('offline')));await settle();h.$('archive-tab').click();
  assert.equal(h.note(),'The archive catalog could not load. Try again or visit the official site.');h.tick();assert.match(h.note(),/could not load/);
});
test('a stale school without its own time shows the time as unknown, never the newer catalog time; legacy ready uses the catalog time',async t=>{
  const newer='2026-09-11T06:00:00.000Z';
  const h=clocked(t,serve(docOf({duke:{status:'stale',source:'https://duke.leanplayer.com/',items:[item]},vt:{status:'ready',source:'https://hokiesports.com/',items:[{...item,id:'vt-one',url:'https://gateway.example/media/archive/vt/vt-one'}]}},newer)),Date.parse(newer)+H);await settle();h.$('archive-tab').click();
  assert.equal(h.note(),'Showing previously checked recordings. The latest refresh failed. Last successful check time unknown.');assert.ok(!h.note().includes(local(newer)));assert.equal(h.$('archive-list').children.length,1);
  h.school('vt');assert.equal(h.note(),`1 recordings · Catalog checked ${local(newer)}. Scores are omitted; broadcaster titles may contain spoilers. Recordings may include pregame and postgame audio.`);
});
test('more than twelve hours old is conspicuous; aging updates only the note while visible and on return to the page',async t=>{
  const h=clocked(t,serve(docOf()),Date.parse(CHECKED)+12*H);await settle();h.$('archive-tab').click();
  h.$('archive-sport').value='Football';h.$('archive-sport').onchange();
  const row=h.$('archive-list').firstElementChild,option=h.$('archive-sport').options[1];row.querySelector('button').click();
  const before=h.counts(),src=h.audio.src,status=h.$('replay-status').textContent;
  assert.ok(!/12 hours/.test(h.note()),'exactly twelve hours is not yet overdue');
  h.visibility('hidden');h.clock.now+=1;h.tick();assert.ok(!/12 hours/.test(h.note()),'hidden pages are not updated by the timer');
  h.visibility('visible');assert.match(h.note(),/^1 recordings · Catalog checked .*\. This list is more than 12 hours old; scheduled updates may have stopped\. Scores are omitted/);
  h.clock.now+=H;h.tick();assert.match(h.note(),/more than 12 hours old/);
  assert.equal(h.$('archive-list').firstElementChild,row);assert.equal(h.$('archive-sport').options[1],option);assert.equal(h.$('archive-sport').value,'Football');
  assert.deepEqual(h.counts(),before);assert.equal(h.audio.src,src);assert.equal(h.$('replay-status').textContent,status);
  h.$('archive-year').value='2025';h.$('archive-year').onchange();assert.match(h.note(),/^No recordings match these filters\. .*more than 12 hours old/,'filtered-empty keeps the time and warning');
  h.school('vt');assert.match(h.note(),/^No recordings are listed for Virginia Tech\. .*more than 12 hours old/);
});
test('stale listings older than twelve hours carry the overdue warning',async t=>{
  const s=clocked(t,serve(docOf({duke:{status:'stale',source:'https://duke.leanplayer.com/',checkedAt:CHECKED,items:[item]}})),Date.parse(CHECKED)+13*H);await settle();s.$('archive-tab').click();
  assert.match(s.note(),/^Showing previously checked recordings\. The latest refresh failed\. Last checked .*\. This list is more than 12 hours old/);
});
test('inclusive five-minute future skew counts as current; beyond it freshness is unknown',async t=>{
  const f=clocked(t,serve(docOf()),Date.parse(CHECKED)-5*M);await settle();f.$('archive-tab').click();assert.ok(!/freshness|12 hours/.test(f.note()));
  f.clock.now-=1;f.tick();assert.match(f.note(),/Catalog checked .*\. Its freshness is unknown\. Scores/);assert.ok(f.note().includes(local(CHECKED)),'the timestamp itself is unchanged');
});
test('a failed reload keeps the loaded list with a caveat across school and filter changes until a reload succeeds',async t=>{
  const h=clocked(t,serve(docOf(),Error('offline'),Error('offline'),docOf()));await settle();h.$('archive-tab').click();
  h.$('archive-retry').click();await settle();
  const caveat=/^Refresh list could not reach the catalog; showing the list loaded earlier\. 2 recordings · /;
  assert.match(h.note(),caveat);assert.equal(h.$('archive-list').children.length,2);assert.equal(h.$('archive-retry').disabled,false);
  h.school('vt');assert.match(h.note(),/^Refresh list could not reach the catalog; .*No recordings are listed for Virginia Tech/);
  h.school('duke');h.$('archive-sport').value='Football';h.$('archive-sport').onchange();assert.match(h.note(),/^Refresh list could not reach the catalog; showing the list loaded earlier\. 1 recordings/);
  h.tick();h.visibility('visible');assert.match(h.note(),/^Refresh list could not reach/);
  h.$('archive-retry').click();await settle();assert.match(h.note(),/^Refresh list could not reach/,'a second failure keeps the caveat');
  h.$('archive-retry').click();await settle();assert.match(h.note(),/^1 recordings · Catalog checked/);assert.equal(h.$('archive-sport').value,'Football');
});
test('the default aging timer runs every 60 seconds on the page window',async t=>{
  const intervals=[];const h=harness(t,undefined,undefined,undefined,{beforeSetup:dom=>{dom.window.setInterval=(fn,ms)=>{intervals.push(ms);return 0;};}});await settle();
  assert.deepEqual(intervals,[60_000]);assert.match(h.$('archive-note').textContent,/recordings · Catalog checked/);
});
test('More → Game broadcasts activates without stopping live audio; Listen returns to it and keyboard navigation has exactly two destinations',async t=>{
 let activated=0,deactivated=0;const sync={active:false,activate(){activated++},deactivate(){deactivated++}};
 const h=harness(t,undefined,undefined,sync);await settle();h.$('nav-broadcasts').click();
 assert.equal(activated,1);assert.equal(h.$('sync-panel').hidden,false);assert.equal(h.$('live-panel').hidden,true);assert.equal(h.$('archive-panel').hidden,true);assert.equal(h.counts().stops,0);
 assert.equal(h.$('listen-tab').getAttribute('aria-selected'),'true');assert.equal(h.$('listen-tab').getAttribute('aria-controls'),'sync-panel');
 assert.equal(h.$('nav-broadcasts').getAttribute('aria-current'),'true');assert.equal(document.body.dataset.view,'sync');
 assert.deepEqual([...document.querySelectorAll('[role=tab]')].map(tab=>tab.id),['listen-tab','archive-tab'],'no hidden third tab');
 h.$('listen-tab').dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(document.activeElement.id,'archive-tab');assert.equal(h.$('sync-panel').hidden,true);assert.equal(deactivated,2);
 h.$('archive-tab').dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(document.activeElement.id,'listen-tab');
 assert.equal(h.$('sync-panel').hidden,false,'Listen returns to the last listening view');assert.equal(activated,2);
 h.$('nav-radio').click();assert.equal(h.$('live-panel').hidden,false);assert.equal(h.$('sync-panel').hidden,true);assert.equal(h.counts().stops,0);
});
test('leaving an active game broadcast asks first; Cancel keeps the view and audio, Continue tears it down',async t=>{
 let deactivated=0;const sync={active:false,activate(){},deactivate(){deactivated++;this.active=false;}};
 const h=harness(t,undefined,undefined,sync);await settle();h.$('nav-broadcasts').click();const settled=deactivated;sync.active=true;
 for(const leave of [()=>h.$('archive-tab').click(),()=>h.$('nav-radio').click()]){
  leave();assert.equal(h.prompt(),true);assert.equal(deactivated,settled);
  h.dismiss();assert.equal(h.$('sync-panel').hidden,false);assert.equal(h.$('listen-tab').getAttribute('aria-selected'),'true');assert.equal(sync.active,true);
 }
 h.$('archive-tab').click();h.proceed();
 assert.equal(h.$('archive-panel').hidden,false);assert.equal(deactivated,settled+1);assert.equal(sync.active,false);assert.equal(document.activeElement.id,'archive-tab');
});
test('leaving a loaded recording for any listening view asks first; Escape cancels',async t=>{
 const sync={active:false,activate(){},deactivate(){}};
 const h=harness(t,undefined,undefined,sync);await settle();h.$('archive-tab').click();h.$('archive-list').querySelector('button').click();
 for(const id of ['listen-tab','nav-radio','nav-broadcasts']){
  h.$(id).click();assert.equal(h.prompt(),true,id);
  h.$('confirm-dialog').dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(h.prompt(),false);assert.equal(h.audio.src,item.url);assert.equal(h.$('archive-panel').hidden,false);assert.equal(h.$('archive-tab').getAttribute('aria-selected'),'true');
 }
 h.$('nav-broadcasts').click();h.proceed();assert.equal(h.audio.hasAttribute('src'),false);assert.equal(h.$('sync-panel').hidden,false);
});
test('a recording takes over from radio only after Continue; Cancel leaves radio, audio and bookmarks untouched',async t=>{
 const saved=[];let radio=true;
 const h=harness(t,undefined,{read:()=>null,save:(...args)=>saved.push(args)},undefined,{liveActive:()=>radio});await settle();h.$('archive-tab').click();
 // Entering Recordings already resets the idle element; only changes after the prompt opens matter.
 const before=h.counts();
 h.$('archive-list').querySelector('button').click();
 assert.equal(h.prompt(),true);assert.deepEqual(h.counts(),before);assert.equal(h.audio.hasAttribute('src'),false);
 h.dismiss();assert.deepEqual(h.counts(),before);assert.equal(h.counts().stops,0);assert.equal(h.counts().plays,0);assert.equal(h.$('replay-player').hidden,true);assert.equal(saved.length,0);
 h.$('archive-list').querySelector('button').click();h.proceed();
 assert.equal(h.counts().stops,1);assert.equal(h.counts().plays,1,'Continue starts playback inside its own click');assert.equal(h.audio.src,item.url);
});
const stubOwner=()=>{const np={claims:0,releases:0,claim(){np.claims++;return {release(){np.releases++;}};}};return np;};
test('replacing a loaded recording, even paused or ended, asks first; Cancel changes nothing and a withdrawn button does nothing',async t=>{
 const saved=[],np=stubOwner();
 const h=harness(t,serve(docOf()),{read:()=>null,save:(...args)=>saved.push(args)},undefined,{nowPlaying:np});await settle();h.$('archive-tab').click();
 h.$('archive-sport').value='Football';h.$('archive-sport').onchange();
 h.$('archive-list').querySelector('button').click();Object.defineProperty(h.audio,'readyState',{value:1});h.audio.currentTime=60;
 h.audio.dispatchEvent(new h.dom.window.Event('pause'));h.audio.dispatchEvent(new h.dom.window.Event('ended'));
 const before={counts:h.counts(),src:h.audio.src,time:h.audio.currentTime,saved:saved.length,claims:np.claims,releases:np.releases,sport:h.$('archive-sport').value,title:h.$('replay-title').textContent};
 const snapshot=()=>({counts:h.counts(),src:h.audio.src,time:h.audio.currentTime,saved:saved.length,claims:np.claims,releases:np.releases,sport:h.$('archive-sport').value,title:h.$('replay-title').textContent});
 h.$('archive-list').querySelector('button').click();assert.equal(h.prompt(),true);h.dismiss();
 assert.deepEqual(snapshot(),before);
 const old=h.$('archive-list').querySelector('button');old.click();assert.equal(h.prompt(),true);
 h.$('archive-sport').value='';h.$('archive-sport').onchange();
 h.proceed();assert.deepEqual(snapshot(),{...before,sport:''},'a button withdrawn by a list re-render does nothing');
 h.$('archive-list').querySelector('button').click();h.$('replay-stop').click();
 assert.equal(h.prompt(),false,'Stop invalidates the pending replacement');h.proceed();assert.equal(np.claims,1);
 h.$('archive-list').querySelector('button').click();assert.equal(h.prompt(),false,'nothing loaded, nothing to confirm');assert.equal(np.claims,2);
});
test('changing school with a loaded recording asks first; Cancel keeps audio, position, owner, bookmarks and filters',async t=>{
 const saved=[],np=stubOwner();
 const h=harness(t,undefined,{read:()=>null,save:(...args)=>saved.push(args)},undefined,{nowPlaying:np});await settle();h.$('archive-tab').click();
 h.$('archive-sport').value='Football';h.$('archive-sport').onchange();h.$('archive-list').querySelector('button').click();
 Object.defineProperty(h.audio,'readyState',{value:1});h.audio.currentTime=42;
 const saves=saved.length;
 h.$('archive-team').value='vt';h.$('archive-team').onchange();
 assert.equal(h.prompt(),true);assert.equal(h.$('archive-team').value,'duke','the committed school stays selected while asking');
 h.dismiss();
 assert.equal(h.audio.src,item.url);assert.equal(h.audio.currentTime,42);assert.equal(np.releases,0);assert.equal(saved.length,saves);
 assert.equal(h.$('archive-sport').value,'Football');assert.equal(h.$('archive-team').value,'duke');assert.equal(h.$('replay-player').hidden,false);
 h.$('archive-team').value='vt';h.$('archive-team').onchange();h.proceed();
 assert.equal(h.audio.hasAttribute('src'),false);assert.equal(np.releases,1);assert.deepEqual(saved.at(-1),['replay','duke:one',42],'the old position is saved on Continue');
 assert.equal(h.$('archive-team').value,'vt');assert.equal(h.$('archive-sport').value,'');
 h.$('archive-team').value='miami';h.$('archive-team').onchange();assert.equal(h.prompt(),false,'without a recording the school changes directly');
});
test('playback and restore failures are mirrored into an open tool dialog and cleared when the recording stops',async t=>{
 const saved=[];const h=harness(t,undefined,{read:()=>({value:125}),save:(...args)=>saved.push(args)});await settle();
 setupShell({doc:document});openDialog(h.$('logs-dialog'));
 const mirror=()=>document.querySelector('#logs-dialog [data-warning-mirror]').textContent;
 h.$('archive-tab').click();h.audio.play=()=>Promise.reject(Error('blocked'));
 h.$('archive-list').querySelector('button').click();await settle();
 assert.match(mirror(),/Press Play in the audio controls/);
 h.$('replay-resume').click();await settle();assert.match(mirror(),/could not resume/);
 Object.defineProperty(h.audio,'duration',{value:1000});Object.defineProperty(h.audio,'readyState',{value:1});
 h.audio.dispatchEvent(new h.dom.window.Event('loadedmetadata'));h.audio.currentTime=0;h.audio.dispatchEvent(new h.dom.window.Event('canplay'));
 h.audio.currentTime=0;h.audio.dispatchEvent(new h.dom.window.Event('canplay'));await settle();
 assert.match(mirror(),/saved position could not be restored/);
 h.$('replay-stop').click();await settle();assert.equal(mirror(),'','a stopped recording no longer warns');
});
test('replay seek groups keep production signs: Back is negative and Ahead positive',async t=>{
 const h=harness(t);await settle();h.$('archive-tab').click();h.$('archive-list').querySelector('button').click();
 Object.defineProperty(h.audio,'duration',{value:1000});Object.defineProperty(h.audio,'currentTime',{value:100,writable:true});
 const back=[...document.querySelectorAll('[aria-labelledby=replay-back] [data-replay-seek]')],ahead=[...document.querySelectorAll('[aria-labelledby=replay-ahead] [data-replay-seek]')];
 assert.deepEqual(back.map(b=>Number(b.dataset.replaySeek)),[-15,-1,-0.25]);assert.deepEqual(ahead.map(b=>Number(b.dataset.replaySeek)),[0.25,1,15]);
 back[0].click();assert.equal(h.audio.currentTime,85);ahead[2].click();assert.equal(h.audio.currentTime,100);
 for(const b of [...back,...ahead])assert.match(b.getAttribute('aria-label'),Number(b.dataset.replaySeek)<0?/^Back /:/^Ahead /);
});
test('recording errors are flagged for modal warning mirrors; routine status is not',async t=>{
 const h=harness(t);await settle();h.$('archive-tab').click();h.$('archive-list').querySelector('button').click();
 assert.equal(h.$('replay-status').dataset.alert,'');
 h.audio.dispatchEvent(new h.dom.window.Event('error'));assert.equal(h.$('replay-status').dataset.alert,'on');
 h.audio.dispatchEvent(new h.dom.window.Event('playing'));assert.equal(h.$('replay-status').dataset.alert,'');
});
