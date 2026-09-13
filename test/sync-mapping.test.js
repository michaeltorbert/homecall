import test from 'node:test';
import assert from 'node:assert/strict';
import { clockSeconds,matchEvent,availableAnchors,selectAnchors,gameOrder } from '../src/sync-mapping.js';
import { normalizeSchedule,normalizePlays,syncData } from '../lib/sync-data.mjs';
const base=Date.parse('2026-09-12T23:00:00Z');
test('clock input validates minutes/seconds without inventing a continuously running clock',()=>{
 assert.equal(clockSeconds('7:29'),449);assert.equal(clockSeconds('15:00'),900);
 for(const s of ['15:01','1:60','-1:00','1.5','abc'])assert.ok(Number.isNaN(clockSeconds(s)));
});
test('event matching requires both schools, date proximity and a unique result',()=>{
 const event={id:'123',start:base,teams:['Georgia Tech','Tennessee']},game={start:base,opponent:'Tennessee'};
 assert.equal(matchEvent([event],'Georgia Tech',game),event);
 assert.equal(matchEvent([event],'Virginia',game),null);assert.equal(matchEvent([event,event],'Georgia Tech',game),null);
 assert.equal(matchEvent([event],'Georgia Tech',{...game,start:base+86400000}),null);
});
test('anchors use actual seekable ranges and offset; gaps and outside clocks never seek',()=>{
 const plays=[{id:'a',quarter:1,clock:'12:00',utc:base},{id:'b',quarter:1,clock:'11:00',utc:base+30000},{id:'c',quarter:1,clock:'10:00',utc:base+60000}];
 const timing={utc:base+60000,position:100,ranges:[[40,50],[90,110]],spans:[{utc:base,position:40,duration:80}]};
 const anchors=availableAnchors(plays,timing);assert.deepEqual(anchors.map(p=>p.id),['a','c']);
 assert.equal(selectAnchors(anchors,1,'12:01').status,'outside');assert.equal(selectAnchors(anchors,2,'10:00').status,'outside');
 assert.equal(selectAnchors(anchors,1,'11:00').matches.length,2);
 assert.equal(availableAnchors(plays,timing,5)[0].position,45);
 assert.equal(availableAnchors(plays,{...timing,utc:undefined}).length,0);
});
test('same clock at distinct plays is ambiguous and quarter bounds sort chronologically',()=>{
 const anchors=[{id:'a',quarter:2,clock:'15:00'},{id:'b',quarter:1,clock:'0:00'},{id:'c',quarter:2,clock:'15:00'}];
 assert.equal(selectAnchors(anchors,2,'15:00').matches.length,2);assert.equal([...anchors].sort(gameOrder)[0].id,'b');
});
test('provider data retains play clocks, drops invalid rows and flags corrected out-of-order timestamps',()=>{
 const play=(id,wallclock)=>({id,wallclock,period:{number:1},clock:{displayValue:'5:08'},text:'Play'});
 const data=normalizePlays({header:{},drives:{previous:[{plays:[play('2',new Date(base+1000).toISOString()),play('1',new Date(base+2000).toISOString()),play('3','bad')]}],current:{plays:[play('2',new Date(base+1000).toISOString())]}}},base);
 assert.equal(data.plays.length,2);assert.equal(data.conflict,true);assert.equal(data.checkedAt,base);assert.equal(data.plays[0].clock,'5:08');
 assert.throws(()=>normalizePlays({}));
});
test('schedule normalization and gateway reject arbitrary hosts or malformed routes',async()=>{
 assert.equal(normalizeSchedule({events:[{id:'123',date:new Date(base).toISOString(),competitions:[{competitors:[{team:{location:'Duke'}},{team:{location:'Illinois'}}]}]}]})[0].id,'123');
 assert.equal(await syncData('/api/sync/plays/http://evil.test'),null);
 assert.equal(await syncData('/api/sync/schedule/59/2026?host=evil'),null);
});

test('timestamp discontinuities map through the correct fragment and overlapping spans are rejected',()=>{
 const timing={utc:base+100000,position:20,ranges:[[0,40]],spans:[{utc:base,position:0,duration:20},{utc:base+100000,position:20,duration:20}]};
 const plays=[{id:'first',quarter:1,clock:'12:00',utc:base+5000},{id:'gap',quarter:1,clock:'11:00',utc:base+50000},{id:'second',quarter:1,clock:'10:00',utc:base+105000}];
 assert.deepEqual(availableAnchors(plays,timing).map(p=>[p.id,p.position]),[['first',5],['second',25]]);
 assert.equal(availableAnchors(plays,{...timing,spans:[...timing.spans,{utc:base,position:30,duration:20}]}).some(p=>p.id==='first'),false);
});

test('verified Southern Mississippi alias matches Auburn without fuzzy opponent matching',()=>{
 const event={id:'401856671',start:base,teams:['Auburn','Southern Miss']};
 assert.equal(matchEvent([event],'Auburn',{start:base,opponent:'Southern Mississippi'}),event);
 assert.equal(matchEvent([event],'Auburn',{start:base,opponent:'Mississippi'}),null);
});

test('play ordering preserves numeric collation, leading-zero ties, large integers and mixed text IDs',()=>{
 const ids=['a10','10','02','9007199254740993','2','a2','001','9007199254740992','1','9'];
 const expected=['001','1','02','2','9','10','9007199254740992','9007199254740993','a2','a10'];
 const plays=ids.map(id=>({id,wallclock:new Date(base+expected.indexOf(id)*1000).toISOString(),period:{number:1},clock:{displayValue:'5:08'}}));
 const data=normalizePlays({header:{},drives:{previous:[{plays}]}},base);
 assert.deepEqual(data.plays.map(play=>play.id),expected);
 assert.equal(data.conflict,false);
});
