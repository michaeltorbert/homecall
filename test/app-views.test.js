// The production view adapter with real markup and guarded navigation callbacks. No network/audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { setupViews, listeningHistory } from '../src/app-views.js';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
test('history requires confirmed output, excludes tones and failed starts, and handles sanitized or malformed source identity', () => {
  const base = { id: '1', team: 'duke', startedAt: '2026-10-22T12:00:00Z', events: [{ type: 'output-ready' }] };
  const result = listeningHistory([{ ...base, mode: 'demo' }, { ...base, sourceId: 'test-tone' }, { ...base, events: [{ type: 'start' }] }, { ...base, sourceId: 'duke-wsjs' }, { ...base, team: 'catalog', events: [null, { type: 'output-ready' }] }]);
  assert.equal(result.length, 2); assert.equal(result[0].source, 'WSJS · Duke affiliate');
  assert.deepEqual([result[1].title, result[1].source], ['Catalog school', 'Source not retained']);
});
test('navigation commits only after authorization, keeps canonical controls, and never starts playback by browsing', t => {
  const dom = new JSDOM(html, { url: 'https://example.test' }); t.after(() => dom.window.close());
  const doc = dom.window.document, $ = id => doc.getElementById(id), canonical = ['team','game','feed','game-refresh','connect','hold'].map($);
  let pending, starts = 0, reads = 0, install = 0;
  const history = [];
  const snap = { team: { key:'duke',name:'Duke' }, teams: [], games: [], sources: [], history, mode: 'Automatic', source: null, status: 'Stopped', gameLabel: '', gameTitle:'Duke', gameMeta:'', art:'/art.png', artFor:()=>'/art.png', mismatch:'', sourceNote:'', gameNote:'', schedule:'', playDisabled:false, playLabel:'Play stream', active:false, refreshDisabled:false };
  const views = setupViews({doc, navigate:(next, commit)=>{pending={next,commit};}, snapshot:()=>{reads++;return snap;}, selectTeam:()=>{},selectSource:()=>{},play:()=>{starts++;},shell:{homeScreen:{open(){install++;return true;}}}});
  views.go('recordings'); assert.equal(doc.body.dataset.screen,'home'); assert.equal(starts,0);
  pending.commit(); assert.equal(doc.body.dataset.screen,'recordings');
  views.go('teams'); assert.equal(doc.body.dataset.screen,'recordings','canceling a pending departure leaves the committed screen');
  pending.commit(); assert.equal(doc.body.dataset.screen,'teams'); assert.equal(starts,0);
  assert.deepEqual(['team','game','feed','game-refresh','connect','hold'].map($),canonical,'controller nodes were moved, not rebuilt');
  assert.equal($('game-panel').closest('#player-details') !== null,true);
  assert.equal($('feed-picker').closest('.player-identity') !== null,true);
  const oldEmpty = $('history-list').firstChild; views.update(); assert.equal($('history-list').firstChild,oldEmpty,'unchanged history is not rebuilt on transport updates');
  $('more-install').click();assert.equal(install,1);assert.ok(reads>0);
});
test('network schedule grouping preserves the controller text and identifies its own network apart from the selected game', async t => {
  const { renderNetworkSchedule } = await import('../src/app-views.js');
  const dom = new JSDOM('<p id="schedule"></p>'); t.after(()=>dom.window.close());
  const target=dom.window.document.getElementById('schedule');
  const text='Next on Duke Sports Network · Next broadcast starts in less than 1 min (Fri 7:00 PM) · Football: Tennessee';
  renderNetworkSchedule(dom.window.document,target,text);
  assert.equal(target.textContent,text);assert.equal(target.querySelector('.network-title').textContent,'Next on Duke Sports Network');
  const title=target.firstChild;renderNetworkSchedule(dom.window.document,target,text);assert.equal(target.firstChild,title);
  renderNetworkSchedule(dom.window.document,target,'Next on Duke Sports Network · Next broadcast time unknown.');
  assert.equal(target.querySelector('.network-event'),null);assert.match(target.textContent,/unknown/);
});
test('keyed choice rows preserve keyboard location on commit, Cancel/Continue and unrelated background labels', async t => {
  const { createConfirm } = await import('../src/ui-shell.js');
  const dom=new JSDOM(html,{url:'https://example.test'});t.after(()=>dom.window.close());
  const doc=dom.window.document,$=id=>doc.getElementById(id),ask=createConfirm(doc);
  const duke={key:'duke',name:'Duke',label:'Duke',radio:true},miami={key:'miami',name:'Miami',label:'Miami',radio:true};
  const s={team:duke,teams:[duke,miami],games:[{id:'g1',label:'Upcoming · Virginia',selected:false,disabled:false}],sources:[{id:'duke-leanstream',label:'Network',description:'Network stream',selected:false,disabled:false},{id:'duke-wsjs',label:'WSJS',description:'Affiliate',selected:false,disabled:false}],history:[],mode:'Automatic',source:null,status:'Stopped',gameLabel:'',gameTitle:'Duke',gameMeta:'',art:'/art.png',artFor:()=>'/art.png',mismatch:'',sourceNote:'',gameNote:'',schedule:'',playDisabled:false,playLabel:'Play',active:false,refreshDisabled:false};
  let views,guarded=false;
  const act=change=>guarded?ask.ask({title:'Change?',text:'Audio stops.'},change):change();
  views=setupViews({doc,navigate:(_next,commit)=>commit(),snapshot:()=>s,selectTeam:key=>act(()=>{s.team=s.teams.find(team=>team.key===key);views.update();}),selectSource:id=>act(()=>{s.sources=s.sources.map(source=>({...source,selected:source.id===id}));views.update();}),play:()=>{},shell:{}});
  views.go('teams');
  const miamiRow=$('team-list').children[1],miamiButton=miamiRow.querySelector('button');miamiButton.focus();miamiButton.click();
  assert.equal(miamiButton.isConnected,true);assert.equal(doc.activeElement,miamiRow.querySelector('strong'),'committed disabled choice moves to its stable visible row label');
  const dukeButton=$('team-list').children[0].querySelector('button');guarded=true;dukeButton.focus();dukeButton.click();$('confirm-cancel').click();
  assert.equal(s.team.key,'miami');assert.equal(doc.activeElement,dukeButton,'Cancel restores the unchanged original action');
  dukeButton.click();$('confirm-continue').click();assert.equal(s.team.key,'duke');assert.equal(doc.activeElement,$('team-list').children[0].querySelector('strong'));
  views.go('streams');const wsjs=$('streams-list').children[1].querySelector('button');wsjs.focus();
  s.games=[{...s.games[0],label:'LIVE · Virginia'}];views.update();assert.equal(doc.activeElement,wsjs);assert.equal($('streams-list').children[1].querySelector('button'),wsjs,'unrelated game labels do not replace source rows');
  wsjs.click();$('confirm-cancel').click();assert.equal(doc.activeElement,wsjs);assert.equal(s.sources[1].selected,false);
  wsjs.click();$('confirm-continue').click();assert.equal(wsjs.isConnected,true);assert.equal(doc.activeElement,$('streams-list').children[1].querySelector('strong'));
  const network=$('streams-list').children[0].querySelector('button');network.focus();s.sources[0].label='Network · refreshed label';views.update();assert.equal(doc.activeElement,network,'an updated label preserves its action node and focus');
});
test('Home keeps recent history heading, empty or populated rows and recording entry in one grid item',t=>{
 const dom=new JSDOM(html,{url:'https://example.test'});t.after(()=>dom.window.close());const doc=dom.window.document;
 const group=doc.querySelector('.home-recent');assert.equal(group.parentElement.id,'home-view');
 for(const selector of ['#home-recent-title','#home-history','[data-route=history]','[data-route=recordings]'])assert.ok(group.querySelector(selector),selector);
 const list=doc.getElementById('home-history');list.innerHTML='<div class="list-row">Duke · Network · Oct 22</div><div class="list-row">Miami · Network · Oct 21</div>';
 assert.equal(list.closest('.home-recent'),group);assert.equal(group.parentElement.id,'home-view');
});
