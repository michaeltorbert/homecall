import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionLog, PREFIX } from '../src/session-log.js';
function storage() { const map = new Map(); return { get length() { return map.size; }, key: i => [...map.keys()][i], setItem: (k,v) => map.set(k,v), getItem: k => map.get(k), removeItem: k => map.delete(k) }; }
function fixture(options = {}) {
  let time = 0, id = 0;
  const log = new SessionLog({ storage: storage(), now: () => time, utc: () => new Date(1700000000000 + time).toISOString(), id: () => `session-${++id}`, ...options });
  log.start('duke','duke-leanstream');
  return { log, advance: n => { time += n; } };
}
const state = (renderedSeconds = 0) => ({ delay: 5, available: 15, paused: false, holding: false, ingesting: true, receivedSeconds: 20, renderedSeconds });
test('six nudges are one episode; requests and effective engine acknowledgments remain separate', () => {
  const { log } = fixture(); log.confirm(state(),'initial');
  for(let i=0;i<6;i++) { log.request('nudge',.25,i,1,'drift',state()); log.acknowledge('nudge',{id:i,epoch:1,result:'applied',before:state(),after:{...state(),delay:5.25}}); }
  log.confirm(state(),'drift'); const result=JSON.parse(log.export(log.session.id));
  assert.equal(result.confirmedEpisodes,1);
  assert.equal(new Set(result.events.filter(e=>e.type==='request').map(e=>e.episodeId)).size,1);
  assert.equal(result.events.filter(e=>e.type==='ack').length,6);
  assert.equal(result.events.find(e=>e.type==='ack').after.delay,5.25);
});
test('hidden and late heartbeats invalidate alignment; no unknown wall time credited', () => {
  const {log,advance}=fixture(); log.confirm(state(),'initial');
  advance(30000);log.heartbeat(state(30)); assert.equal(log.session.userConfirmedObservedSeconds,30);
  advance(120000);log.heartbeat(state(150)); assert.equal(log.confirmed,false);assert.equal(log.session.userConfirmedObservedSeconds,30);
  assert.ok(log.session.events.some(e=>e.type==='observation-gap'));
});
test('bounds and memory-only failure preserve export; no URLs/errors or arbitrary fields are serialized', () => {
  const {log}=fixture({maxEvents:4,storage:{setItem(){throw Error('quota');}},maxSessions:2});
  for(let i=0;i<10;i++) log.add('source-error',{url:'https://secret/?token=123',error:'PRIVATE',device:'PRIVATE'}, {...state(),url:'PRIVATE'});
  const result=log.export(log.session.id);assert.ok(log.memoryOnly);assert.ok(!result.includes('PRIVATE'));assert.ok(!result.includes('token'));
  const parsed=JSON.parse(result);assert.equal(parsed.events.length,4);assert.equal(parsed.truncatedEvents,7);
  log.end();log.start('miami','miami-wqam');log.end();log.start('vt','vt-leanstream');assert.equal(log.memory.size,2);
});
test('reload creates a new session; old unclosed snapshot is explicit and has no false end time', () => {
  const store=storage();const first=fixture({storage:store});const old=first.log.session.id;
  const second=new SessionLog({storage:store,id:()=> 'new', now:()=>0});second.start('vt','vt-leanstream');
  const result=JSON.parse(second.export(old));assert.equal(result.status,'last-saved-unclosed');assert.equal(result.endedAt,null);
  assert.equal(second.session.id,'new');assert.ok(store.getItem(PREFIX+old));
});
test('interruption abandons correction episode and confirmation requires actual playing state', () => {
  const {log}=fixture();log.request('hold',undefined,1,1,'initial',state());log.boundary('source-waiting',state());
  assert.equal(log.episode,null);assert.equal(log.confirm({...state(),paused:true},'initial'),false);
  assert.equal(log.session.confirmedEpisodes,0);assert.ok(log.session.events.some(e=>e.type==='episode-abandoned'));
});
test('session retention and deliberate deletion leave no saved entries', () => {
  const {log,advance}=fixture({maxSessions:2});for(let i=0;i<4;i++){log.end();advance(1000);log.start('vt','vt-leanstream');}
  assert.equal(log.list().length,2);assert.equal(log.clear(),false);log.end();assert.equal(log.clear(),true);assert.equal(log.list().length,0);
});
test('ack preserves the independent AudioContext clock; malformed persisted records are ignored',()=>{
 const store=storage();store.setItem(PREFIX+'broken',JSON.stringify({schemaVersion:1,events:[]}));
 const {log}=fixture({storage:store});assert.equal(log.list().length,1);
 log.acknowledge('nudge',{id:1,epoch:3,result:'applied',before:state(),after:state(),contextSeconds:7.125});
 assert.equal(log.session.events.at(-1).after.contextSeconds,7.125);
});
test('clear removes malformed own records too without touching unrelated site preferences',()=>{
 const store=storage();store.setItem(PREFIX+'broken','{');store.setItem('other.preference','keep');
 const {log}=fixture({storage:store});log.end();assert.equal(log.clear(),true);
 assert.equal(store.getItem(PREFIX+'broken'),undefined);assert.equal(store.getItem('other.preference'),'keep');
});
