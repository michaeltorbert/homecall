import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchedule, normalizePlays, syncData } from '../lib/sync-data.mjs';
const now = Date.parse('2026-09-13T02:00:00Z');
const competitors = () => [{id:'59',team:{id:'59',location:'Georgia Tech'}},{id:'2633',team:{id:'2633',location:'Tennessee'}}];
const summary = () => ({header:{id:'123',uid:'s:20~l:23~e:123',league:{id:'23',slug:'college-football'},season:{year:2026},competitions:[{id:'123',competitors:competitors()}]},drives:{previous:[]}});
const schedule = () => ({team:{id:'59'},season:{year:2026},events:[{id:'123',date:'2027-01-02T20:00:00Z',season:{year:2026},competitions:[{id:'123',competitors:competitors()}]}]});
test('supported timing teams are exact provider associations and require no live giant list',async()=>{
 const teams=await syncData('/api/sync/teams',{fetcher(){throw Error('unexpected network');}});
 assert.deepEqual(teams.map(t=>[t.id,t.name]),[['150','Duke'],['59','Georgia Tech'],['258','Virginia'],['2','Auburn']]);
 assert.equal(teams.find(t=>t.id==='59').homestreamId,'410422f0-663f-4e3d-82e2-787d954ae29d');
 teams[0].id='bad'; assert.equal((await syncData('/api/sync/teams'))[0].id,'150');
});
test('schedule binds requested team and season while preserving January postseason season',()=>{
 assert.deepEqual(normalizeSchedule(schedule(),{teamId:'59',season:2026})[0].teamIds,['59','2633']);
 assert.equal(normalizeSchedule(schedule())[0].season,2026);
 assert.throws(()=>normalizeSchedule(schedule(),{teamId:'150',season:2026}));
 assert.throws(()=>normalizeSchedule(schedule(),{teamId:'59',season:2027}));
 for(const mutate of [d=>d.events[0].season.year=2027,d=>d.events[0].competitions[0].id='999',d=>d.events[0].competitions.push(d.events[0].competitions[0]),d=>d.events[0].competitions[0].competitors[0].team.id='2',d=>d.events.push(structuredClone(d.events[0]))]){
  const data=schedule();mutate(data);assert.deepEqual(normalizeSchedule(data),[]);
 }
});
test('summary requires exact event, sport, league, season and distinct competitor identities',()=>{
 assert.equal(normalizePlays(summary(),now,{eventId:'123'}).eventId,'123');
 assert.throws(()=>normalizePlays(summary(),now,{eventId:'456'}));
 for(const mutate of [d=>d.header.uid='s:40~l:46~e:123',d=>d.header.league.id='46',d=>d.header.league.slug='mens-college-basketball',d=>d.header.season.year='2026',d=>d.header.competitions[0].id='456',d=>d.header.competitions[0].competitors[1]=d.header.competitions[0].competitors[0]]){
  const data=summary();mutate(data);assert.throws(()=>normalizePlays(data,now,{eventId:'123'}));
 }
});
test('snapshot age remains unknown without evidence and includes normalization residence',()=>{
 assert.equal(normalizePlays(summary(),now).ageMs,null);
 assert.equal(normalizePlays(summary(),now,{ageMs:4000,receivedAt:now-1000}).ageMs,5000);
 assert.equal(normalizePlays(summary(),now,{ageMs:0,receivedAt:now+1}).ageMs,null);
 assert.equal(normalizePlays(summary(),now,{ageMs:-1}).ageMs,null);
 assert.equal(normalizePlays(summary(),now,{ageMs:null}).ageMs,null);
});
test('source order and corrected rows replace prior snapshots without assuming numeric IDs',()=>{
 const data=summary();const play=(id,ms)=>({id,wallclock:new Date(now+ms).toISOString(),period:{number:1},clock:{displayValue:'5:00'}});
 data.drives.previous=[{plays:[play('100',0),play('2',1000)]}];
 let normalized=normalizePlays(data,now);assert.deepEqual(normalized.plays.map(p=>p.id),['100','2']);assert.equal(normalized.conflict,false);
 data.drives.current={plays:[play('2',-1000)]};normalized=normalizePlays(data,now);assert.equal(normalized.plays.length,2);assert.equal(normalized.conflict,true);
});
test('invalid final corrections withdraw earlier anchors rather than preserve stale timestamps',()=>{
 const data=summary();
 const play={id:'1',wallclock:'2026-09-13T02:00:00Z',period:{number:1},clock:{displayValue:'5:00'}};
 data.drives.previous=[{plays:[play]}];
 for(const replacement of [{...play,wallclock:'invalid'},{...play,clock:{}},{...play,period:{number:0}}]) {
  data.drives.current={plays:[replacement]};assert.deepEqual(normalizePlays(data,now).plays,[]);
 }
});
test('timing rejects timezone-free and impossible dates; explicit offsets map consistently',()=>{
 const data=summary();
 for (const wallclock of ['2026-09-13T02:00:00','2026-02-30T02:00:00Z','2026-09-13T24:00:00Z']) {
  data.drives.current={plays:[{id:'1',wallclock,period:{number:1},clock:{displayValue:'5:00'}}]};
  assert.deepEqual(normalizePlays(data,now).plays,[]);
 }
 data.drives.current.plays[0].wallclock='2026-09-12T22:00:00-04:00';
 assert.equal(normalizePlays(data,now).plays[0].utc,now);
 const fixture=schedule();fixture.events[0].date='2027-01-02T20:00:00';assert.deepEqual(normalizeSchedule(fixture),[]);
});

test('provider schedule dates with minute precision retain explicit UTC identity',()=>{
 const data=schedule();data.events[0].date='2026-09-12T23:00Z';
 assert.equal(normalizeSchedule(data)[0].start,Date.parse('2026-09-12T23:00:00Z'));
});
