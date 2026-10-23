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
  assert.equal($('game-panel').closest('#player-details'),null,'the game choice is directly on the Player, not in a disclosure');
  assert.equal($('game-panel').previousElementSibling,doc.querySelector('.player-screen .selectors'));
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
  // A team row only opens that team's read-only page; it never changes the Player team.
  const miamiButton=$('team-list').children[1].querySelector('button');miamiButton.click();
  assert.equal(doc.body.dataset.screen,'team');assert.equal(views.browsed,'miami');assert.equal(s.team.key,'duke');
  guarded=true;views.go('teams');
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
// ---------- Listening feedback #63/#65/#66/#68 (presentation fixtures) ----------
const team=(key,name,extra={})=>({key,name,label:name,catalogId:null,radio:false,...extra});
const TEAMS=[team('duke','Duke',{catalogId:'D',radio:true}),team('vt','Virginia Tech',{radio:true}),team('auburn','Auburn',{catalogId:'A'})];
const base=over=>({team:TEAMS[0],teams:TEAMS,games:[],sources:[],history:[],mode:'Automatic',source:null,status:'Stopped',gameLabel:'',gameTitle:'Duke',gameMeta:'',art:'/art.png',artFor:()=>'/art.png',mismatch:'',sourceNote:'',gameNote:'',schedule:'',playDisabled:false,playLabel:'Play',active:false,refreshDisabled:false,recordings:['duke','miami','vt'],officialFor:key=>key==='vt'?'https://hokiesports.com/virginia-tech-sports-network':null,...over});
const flushViews=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
test('More toggles back to the last committed screen; a canceled departure changes nothing',t=>{
  const dom=new JSDOM(html,{url:'https://example.test'});t.after(()=>dom.window.close());
  const doc=dom.window.document,$=id=>doc.getElementById(id);let pending=null;
  const views=setupViews({doc,navigate:(next,commit)=>{pending={next,commit};},snapshot:()=>base(),selectSource:()=>{},play:()=>{},shell:{}});
  views.go('schedule');pending.commit();views.go('more');pending.commit();
  assert.equal($('more').getAttribute('aria-label'),'Close More');assert.match($('more').textContent,/Close$/);
  $('more').click();assert.equal(pending.next,'schedule','More while open returns to the previous screen');
  $('more').click();assert.equal(doc.body.dataset.screen,'more','an unconfirmed return leaves More open');
  pending.commit();assert.equal(doc.body.dataset.screen,'schedule');assert.equal($('more').getAttribute('aria-label'),'More');
  assert.ok($('build').closest('#more-view'),'build and affiliation live in More');assert.equal($('more-refresh'),null,'no duplicate Player refresh in More');
});
test('Schedule lists this week across catalog schools with dated TBD, undated and partial-failure truth, and refresh stays read-only',async t=>{
  const dom=new JSDOM(html,{url:'https://example.test'});t.after(()=>dom.window.close());
  const doc=dom.window.document,$=id=>doc.getElementById(id);const calls=[],listens=[];let gameRefresh=0;
  const now=new Date(2026,9,21,12).getTime();
  const browse={week:async(schools,{fresh})=>{calls.push([schools.map(s=>s.key),!!fresh]);return {week:{start:new Date(2026,9,19).getTime(),end:new Date(2026,9,26).getTime(),first:'2026-10-19',last:'2026-10-25'},schools:2,failed:['Auburn'],
    entries:[{key:'duke',school:'Duke',placement:'timed',game:{id:'g1',opponent:'Virginia',start:new Date(2026,9,23,19).getTime(),url:'https://gateway.example/media/game/D/g1'}},{key:'duke',school:'Duke',placement:'tbd',game:{id:'g2',opponent:'Navy',start:null,date:'2026-10-25',url:null}}],
    undated:[{key:'duke',school:'Duke',game:{id:'g3',opponent:'Army',start:null}}]};},games:async()=>[]};
  const views=setupViews({doc,navigate:(_n,commit)=>commit(),snapshot:()=>base(),selectSource:()=>{},play:()=>{},shell:{},browse,listen:(key,id)=>listens.push([key,id]),now:()=>now});
  $('game-refresh').onclick=()=>gameRefresh++;
  views.go('schedule');await flushViews();
  assert.deepEqual(calls,[[['duke','auburn'],false]],'every catalog school, never the network-only one');
  assert.match($('schedule-subtitle').textContent,/^This week · /);
  assert.deepEqual([...$('schedule-list').querySelectorAll('.list-row strong')].map(s=>s.textContent),['Duke vs Virginia','Duke vs Navy']);
  const details=[...$('schedule-list').querySelectorAll('.list-row span')].map(s=>s.textContent);
  assert.match(details[0],/\(unconfirmed\) · Duke game feed posted$/);assert.equal(details[1],'Time TBD · Duke game feed not posted yet');
  assert.match($('schedule-note').textContent,/Couldn’t load Auburn; refresh to retry\./);
  assert.match($('schedule-undated').textContent,/^Date not announced, so not shown for this week: Duke vs Army\./);
  assert.deepEqual([...$('schedule-network').querySelectorAll('strong')].map(s=>s.textContent),['Virginia Tech'],'network-only schools are routed to their pages');
  [...$('schedule-list').querySelectorAll('button')].find(b=>b.textContent==='Listen').click();assert.deepEqual(listens,[['duke','g1']]);
  [...$('schedule-list').querySelectorAll('button')].find(b=>b.textContent==='Team').click();assert.equal(doc.body.dataset.screen,'team');assert.equal(views.browsed,'duke');
  views.go('schedule');$('schedule-refresh').click();await flushViews();
  assert.deepEqual(calls.at(-1),[['duke','auburn'],true]);assert.equal(gameRefresh,0,'never the Player catalog refresh');
});
test('a network-only school’s page offers its live network and official player, and says plainly that no game-feed schedule exists',async t=>{
  const dom=new JSDOM(html,{url:'https://example.test'});t.after(()=>dom.window.close());
  const doc=dom.window.document,$=id=>doc.getElementById(id);const listens=[];let reads=0;
  const views=setupViews({doc,navigate:(_n,commit)=>commit(),snapshot:()=>base(),selectSource:()=>{},play:()=>{},shell:{},browse:{games:async()=>{reads++;return [];},week:async()=>({})},listen:key=>listens.push(key)});
  views.openTeam('vt');await flushViews();
  assert.equal(reads,0,'no catalog read for a school without a catalog identity');
  assert.equal($('team-live').querySelector('strong').textContent,'Virginia Tech Sports Network');
  assert.equal($('team-live').querySelector('a').href,'https://hokiesports.com/virginia-tech-sports-network');
  assert.match($('team-live-note').textContent,/no dedicated game-feed schedule for Virginia Tech/);
  assert.equal($('team-games-note').textContent,'No game feeds are listed for Virginia Tech.');assert.equal($('team-games-refresh').hidden,true);
  [...$('team-live').querySelectorAll('button')].find(b=>b.textContent==='Listen').click();assert.deepEqual(listens,['vt']);
});
