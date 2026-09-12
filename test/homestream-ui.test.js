import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../src/homestream-ui.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function','function');
const tick=()=>new Promise(r=>setImmediate(r));
function harness(t,{read,probe}={}){
 const dom=new JSDOM('<section id="game-panel"><select id="game"></select><p id="game-note"></p><button id="game-refresh"></button></section>',{url:'https://example.test/homecall/',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window;w.AbortController=AbortController;w.readJSON=read;w.checkPlaylist=probe;w.eval(source+';window.setup=setupHomestream;');
 let stopped=0,rendered=0;const ui=w.setup({onChange:()=>{stopped++},onReady:()=>{rendered++}});
 return{ui,w,$:id=>w.document.getElementById(id),get stopped(){return stopped},get rendered(){return rendered}};
}
const games=[{id:'now',start:Date.now(),url:'https://example.cloudfront.net/now.m3u8',opponent:'Tennessee'},{id:'future',start:Date.now()+604800000,url:null,opponent:'Mercer'}];
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
