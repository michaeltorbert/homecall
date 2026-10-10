import { metadataURL, mediaURL } from '../src/gateway.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../src/homestream-ui.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function','function');
const tick=()=>new Promise(r=>setImmediate(r));
function harness(t,{read,probe,gateway='https://gateway.example',hooks={}}={}){
 const dom=new JSDOM('<section id="game-panel"><select id="game"></select><p id="game-note"></p><button id="game-refresh"></button></section>',{url:'https://example.test/homecall/',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window;w.AbortController=AbortController;w.metadataURL=metadataURL;w.mediaURL=mediaURL;w.__GATEWAY_ORIGIN__=gateway;w.readJSON=read;w.checkPlaylist=probe;w.eval(source+';window.setup=setupHomestream;');
 let stopped=0,rendered=0;const ui=w.setup({onChange:()=>{stopped++},onReady:()=>{rendered++},...hooks});
 return{ui,w,$:id=>w.document.getElementById(id),get stopped(){return stopped},get rendered(){return rendered}};
}
const games=[{id:'now',start:Date.now(),url:'https://gateway.example/media/game/team-id/now',opponent:'Tennessee'},{id:'future',start:Date.now()+604800000,url:null,opponent:'Mercer'}];
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

test('Homestream discovery sends both metadata requests to the configured gateway and media probes use the relay',async t=>{
 const requests=[],probes=[];const h=harness(t,{gateway:'https://gateway.example',read:async url=>{requests.push(url.href);return reader(url);},probe:async url=>{probes.push(url);return 'ready';}});
 h.ui.setEnabled(true);await tick();assert.deepEqual(requests,['https://gateway.example/api/homestream/teams','https://gateway.example/api/homestream/games/team-id']);assert.deepEqual(probes,[games[0].url]);
});

const plain=value=>JSON.parse(JSON.stringify(value));
const texts=h=>[...h.$('game').options].map(o=>o.textContent);
test('onGames receives every game after options and selection are restored, before the feed probe',async t=>{
 const seen=[];let atProbe,finishProbe,probes=0,h;
 h=harness(t,{read:reader,probe:()=>{probes++;atProbe={calls:seen.length,value:h.$('game').value};return new Promise(r=>finishProbe=r);},hooks:{onGames:(list,meta)=>seen.push(plain({list,meta,value:h.$('game').value,options:texts(h)}))}});
 h.ui.setEnabled(true);await tick();
 assert.equal(seen.length,1);assert.deepEqual(atProbe,{calls:1,value:'now'});
 assert.deepEqual(seen[0].list,games.map(({id,opponent,start})=>({id,opponent,start})));assert.deepEqual(seen[0].meta,{teamId:'team-id'});
 assert.equal(seen[0].value,'now');assert.equal(seen[0].options.length,2);assert.match(seen[0].options[1],/feed not published$/);
 finishProbe('ready');await tick();assert.equal(h.ui.ready.id,'now');assert.equal(probes,1);
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
test('cross-origin and mismatched game media never reach the probe or Play readiness', async t => {
 for (const url of ['https://upstream.example/live.m3u8','https://gateway.example/media/game/team-id/other','https://gateway.example/media/game/team-id/now?target=private']) {
  let probes=0;
  const h=harness(t,{read:async path=>path.pathname.endsWith('/teams')?[{id:'team-id',name:'Georgia Tech'}]:[{...games[0],url}],probe:async()=>{probes++;return 'ready';}});
  h.ui.setEnabled(true);await tick();assert.equal(probes,0);assert.equal(h.ui.ready,null);assert.match(h.$('game-note').textContent,/could not load/);
 }
});
