import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { setupArchive } from '../src/archive.js';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const item={id:'one',opponent:'Tulane',sport:'Football',start:'2026-09-05T18:00:00Z',kind:'Game recording',url:'https://s3.amazonaws.com/archive.leanplayer.com/gameday/1788631200_35_70596105.mp3'};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t, fetcher) {
  const dom=new JSDOM(html,{url:'https://example.test/homecall/'});
  t.mock.method(globalThis,'fetch',fetcher || (async()=>({ok:true,json:async()=>({checkedAt:'2026-09-11T00:00:00Z',schools:{duke:{status:'ready',source:'https://duke.leanplayer.com/',items:[item]},miami:{status:'external',source:'https://miamihurricanes.com/',items:[]},vt:{status:'ready',source:'https://hokiesports.com/',items:[]}}})})));
  const oldDocument=globalThis.document,oldOption=globalThis.Option;
  globalThis.document=dom.window.document; globalThis.Option=dom.window.Option;
  t.after(()=>{globalThis.document=oldDocument;globalThis.Option=oldOption;dom.window.close();});
  const $=id=>document.getElementById(id), audio=$('replay-audio');
  let stops=0,paused=0,loads=0,plays=0;
  audio.pause=()=>{paused++;}; audio.load=()=>{loads++;};audio.play=async()=>{plays++;};
  setupArchive({stopLive:()=>{stops++;},selectedTeam:()=> 'duke'});
  return {$,audio,counts:()=>({stops,paused,loads,plays}),dom};
}
test('archive stops live audio, supports playback, filters and unloads when leaving or changing school',async t=>{
  const h=harness(t);await settle();
  h.$('archive-tab').click();
  assert.equal(h.counts().stops,1);assert.equal(h.$('live-panel').hidden,true);
  assert.equal(h.$('archive-panel').hidden,false);assert.equal(h.$('archive-list').children.length,1);
  h.$('archive-list').querySelector('button').click();await settle();
  assert.equal(h.audio.src,item.url);assert.equal(h.counts().plays,1);
  assert.equal(h.$('replay-player').hidden,false);
  h.$('archive-team').value='miami';h.$('archive-team').onchange();
  assert.equal(h.audio.hasAttribute('src'),false);assert.equal(h.$('replay-player').hidden,true);
  assert.match(h.$('archive-note').textContent,/aren’t available/);
  h.$('live-tab').click();assert.equal(h.$('live-sidebar').hidden,false);
  assert.equal(h.$('archive-panel').hidden,true);
});
test('keyboard tabs move focus and published catalog failure can retry',async t=>{
  let attempts=0;
  const h=harness(t,async()=>{attempts++;throw Error('offline');});await settle();
  assert.match(h.$('archive-note').textContent,/could not load/);
  h.$('live-tab').dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
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
  h.$('archive-team').value='miami';h.$('archive-team').onchange();
  h.$('replay-status').textContent='new status';reject(Error('old'));await settle();
  assert.equal(h.$('replay-status').textContent,'new status');
});

test('same recording retries, resume and hold ignore stale play failures; selected tab is a no-op',async t=>{
  const h=harness(t);await settle();h.$('archive-tab').click();
  const failures=[];h.audio.play=()=>new Promise((_,reject)=>failures.push(reject));
  const button=h.$('archive-list').querySelector('button');
  button.click();button.click();h.$('replay-status').textContent='new playback';
  failures[0](Error('old request'));await settle();assert.equal(h.$('replay-status').textContent,'new playback');
  const before=h.counts();h.$('archive-tab').click();assert.deepEqual(h.counts(),before);
  assert.equal(h.audio.src,item.url);
  h.$('replay-resume').click();button.click();h.$('replay-status').textContent='another recording';
  failures[2](Error('old resume'));await settle();assert.equal(h.$('replay-status').textContent,'another recording');
  h.$('replay-hold').click();failures[3](Error('interrupted by pause'));await settle();
  assert.match(h.$('replay-status').textContent,/paused at the play/);
});
