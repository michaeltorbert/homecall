import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchedule, normalizePlays, normalizeStatusSnapshot, normalizeGameStatus, syncData } from '../lib/sync-data.mjs';
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

// Complete competition.status shapes copied from the public Duke 2026 schedule (2026-10-07).
const observedFinal = () => ({clock:0,displayClock:'0:00',period:4,type:{id:'3',name:'STATUS_FINAL',state:'post',completed:true,description:'Final',detail:'Final',shortDetail:'Final'}});
const observedScheduled = () => ({clock:0,displayClock:'0:00',period:0,type:{id:'1',name:'STATUS_SCHEDULED',state:'pre',completed:false,description:'Scheduled',detail:'Sat, October 10th at 3:30 PM EDT',shortDetail:'10/10 - 3:30 PM EDT'}});
// Synthetic: the supported in-progress contract, not a captured live provider sample.
const synthetic = (name, state, completed) => ({clock:600,displayClock:'10:00',period:2,type:{id:'2',name,state,completed,description:'synthetic'}});
const statusSchedule = (...statuses) => ({team:{id:'59'},season:{year:2026},events:statuses.map((status,i) => ({id:String(100+i),date:`2026-10-${String(10+i).padStart(2,'0')}T19:30Z`,season:{year:2026},competitions:[{id:String(100+i),competitors:competitors(),...(status === undefined ? {} : {status})}]}))});
test('game status maps only coherent allowlisted triples; observed final/scheduled and synthetic live/halftime',()=>{
 assert.equal(normalizeGameStatus({}, {status:observedFinal()}),'completed');
 assert.equal(normalizeGameStatus({status:null}, {status:observedScheduled()}),'upcoming');
 assert.equal(normalizeGameStatus({}, {status:synthetic('STATUS_IN_PROGRESS','in',false)}),'live');
 assert.equal(normalizeGameStatus({}, {status:synthetic('STATUS_HALFTIME','in',false)}),'live');
 // Event-level copy alone, or an exactly agreeing copy, is accepted.
 assert.equal(normalizeGameStatus({status:observedFinal()}, {}),'completed');
 assert.equal(normalizeGameStatus({status:observedFinal()}, {status:observedFinal()}),'completed');
 for (const [event, competition] of [
  [{}, {}], [{status:null}, {status:null}],
  [{status:observedScheduled()}, {status:observedFinal()}],
  [{status:synthetic('STATUS_HALFTIME','in',false)}, {status:synthetic('STATUS_IN_PROGRESS','in',false)}],
  [{status:{type:{name:'STATUS_FINAL',state:'post'}}}, {status:observedFinal()}],
  [{}, {status:{type:{name:'STATUS_FINAL',state:'post',completed:'true'}}}],
  [{}, {status:{type:{name:3,state:'post',completed:true}}}],
  [{}, {status:'STATUS_FINAL'}], [{}, {status:{}}],
  [{}, {status:synthetic('STATUS_FINAL','in',true)}], [{}, {status:synthetic('STATUS_FINAL','post',false)}],
  [{}, {status:synthetic('STATUS_SCHEDULED','pre',true)}], [{}, {status:synthetic('STATUS_IN_PROGRESS','post',false)}],
  ...['STATUS_POSTPONED','STATUS_CANCELED','STATUS_SUSPENDED','STATUS_DELAYED','STATUS_END_PERIOD','STATUS_FINAL_OT','STATUS_RAIN_DELAY','status_in_progress'].map(name => [{}, {status:synthetic(name,'in',false)}])
 ]) assert.equal(normalizeGameStatus(event, competition),'unknown',JSON.stringify([event,competition]));
});
test('status envelope keeps only identity/matching fields, reuses strict schedule identity and keeps unknown age unknown',()=>{
 const data=statusSchedule(observedFinal(),observedScheduled(),synthetic('STATUS_IN_PROGRESS','in',false),undefined,synthetic('STATUS_POSTPONED','post',false));
 const snapshot=normalizeStatusSnapshot(data,now,{teamId:'59',season:2026,ageMs:11000,receivedAt:now-250});
 assert.deepEqual(Object.keys(snapshot),['schemaVersion','teamId','season','checkedAt','ageMs','events']);
 assert.deepEqual([snapshot.schemaVersion,snapshot.teamId,snapshot.season,snapshot.checkedAt,snapshot.ageMs],[1,'59',2026,now,11250]);
 assert.deepEqual(snapshot.events.map(e=>e.status),['completed','upcoming','live','unknown','unknown']);
 for (const event of snapshot.events) assert.deepEqual(Object.keys(event),['id','start','teams','teamIds','season','status']);
 assert.ok(!JSON.stringify(snapshot).includes('Final') && !JSON.stringify(snapshot).includes('EDT'),'provider detail text is not forwarded');
 assert.deepEqual(snapshot.events.map(({status,...event})=>event),normalizeSchedule(data,{teamId:'59',season:2026}));
 assert.equal(normalizeStatusSnapshot(data,now,{teamId:'59',season:2026}).ageMs,null);
 assert.equal(normalizeStatusSnapshot(data,now,{teamId:'59',season:2026,ageMs:0,receivedAt:now+1}).ageMs,null);
 assert.throws(()=>normalizeStatusSnapshot(data,now,{teamId:'150',season:2026}));
 assert.throws(()=>normalizeStatusSnapshot(data,now,{teamId:'59',season:2025}));
 const duplicated=statusSchedule(observedFinal(),observedScheduled());duplicated.events.push(structuredClone(duplicated.events[0]));
 assert.deepEqual(normalizeStatusSnapshot(duplicated,now,{teamId:'59',season:2026}).events.map(e=>e.id),['101']);
});
test('status adapter reads only verified supported schedules and carries representation age',async()=>{
 const urls=[];let wall=now;
 const fetcher=async url=>{urls.push(url);wall+=200;return Response.json(statusSchedule(observedScheduled()),{headers:{Date:new Date(now-10000).toUTCString()}});};
 const snapshot=await syncData('/api/sync/status/59/2026',{fetcher,now:()=>wall});
 assert.deepEqual(urls,['https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/59/schedule?season=2026']);
 assert.equal(snapshot.events[0].status,'upcoming');assert.equal(snapshot.ageMs,11200);
 for (const path of ['/api/sync/status/356/2026','/api/sync/status/1500/2026','/api/sync/status/059/2026']) assert.equal(await syncData(path,{fetcher}),null);
 assert.equal(urls.length,1);
});

test('provider schedule dates with minute precision retain explicit UTC identity',()=>{
 const data=schedule();data.events[0].date='2026-09-12T23:00Z';
 assert.equal(normalizeSchedule(data)[0].start,Date.parse('2026-09-12T23:00:00Z'));
});
