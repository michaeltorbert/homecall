import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEvents,safeAudioURL,rowCounts} from '../lib/duke-source.mjs';
const policy=value=> {const u=new URL(value);return u.origin==='https://audio.example' && (u.pathname==='/live' || /^\/replay\/\d+\.mp3$/.test(u.pathname));};
const event=(id,start,end)=>`<event><id>${id}</id><start_timestamp>${start}</start_timestamp><end>${end}</end><sport_id>1</sport_id><opponent>North &amp; South</opponent><url>https://audio.example/live?sport=FB</url></event>`;
test('expired current flags cannot produce live events',()=>{
 const xml=`<main><events><current_ev>${event('old',1,'1970-01-01 00:00:20')}</current_ev><upcoming_ev>${event('next',200,'1970-01-01 00:05:00')}</upcoming_ev></events></main>`;
 const result=parseEvents(xml,'live',100000,policy);
 assert.equal(result.length,1);assert.equal(result[0].status,'upcoming');assert.equal(result[0].opponent,'North & South');
});
test('source selection rejects foreign streams and credential-bearing URLs',()=>{
 for(const url of ['http://audio.example/live','https://evil.example/a.mp3','https://user:pass@audio.example/live','https://audio.example/other/a.mp3']) assert.equal(safeAudioURL(url,policy),null);
 assert.ok(safeAudioURL('https://audio.example/replay/123.mp3',policy));
});
test('XML entities are not evaluated',()=>assert.throws(()=>parseEvents('<!DOCTYPE x><main></main>','live')));

// Strict archive refresh parsing (issue #4). Synthetic rows of the known feed contract only.
const NOW=Date.parse('2026-09-10T00:00:00Z');
const row=({id='g1',sport='1',start='1788645600',end='2026-09-06 21:00:00',opponent='Tulane',archive='https://audio.example/replay/1.mp3',recorded='',extra=''}={})=>`<event>${id===null?'':`<id>${id}</id>`}${start===null?'':`<start_timestamp>${start}</start_timestamp>`}${end===null?'':`<end>${end}</end>`}${sport===null?'':`<sport_id>${sport}</sport_id>`}<opponent>${opponent}</opponent>${archive===null?'':`<archive_url>${archive}</archive_url>`}${recorded?`<recorded_url>${recorded}</recorded_url>`:''}${extra}</event>`;
const feed=(previous,archived='')=>`<main><events><previous_ev>${previous}</previous_ev>${archived===null?'':`<archived_ev>${archived}</archived_ev>`}</events></main>`;
const strict=xml=>parseEvents(xml,'archive',NOW,policy,{strict:true});
function rejects(xml,key){const counts=rowCounts();assert.throws(()=>parseEvents(xml,'archive',NOW,policy,{strict:true,counts}),/^Error: Archive rows rejected$/);assert.ok(counts[key]>=1,key);return counts;}
test('strict Duke archive accepts valid past rows, genuinely empty feeds and legitimate exclusions',()=>{
 const result=strict(feed(row()));assert.equal(result.length,1);assert.deepEqual([result[0].id,result[0].sport,result[0].url],['g1','Football','https://audio.example/replay/1.mp3']);
 assert.deepEqual(strict(feed('')),[]);assert.deepEqual(strict('<main><events><previous_ev/><archived_ev /></events></main>'),[]);
 const counts=rowCounts();
 const only=[row({id:'u',sport:'9',archive:'https://foreign.example/x.mp3',start:'bad'}),row({id:'f',start:String(NOW/1000+60),end:'2026-09-11 00:00:00'}),row({id:'n',archive:''}),row({id:'s',archive:null,extra:'<archive_url/>'}),row({id:'s2',archive:null,extra:'<archive_url />'}),row({id:'x',archive:null,sport:null})].join('');
 assert.deepEqual(parseEvents(feed(only),'archive',NOW,policy,{strict:true,counts}),[]);
 assert.deepEqual({rows:counts.rows,unsupported:counts.unsupported,future:counts.future,unrecorded:counts.unrecorded,accepted:counts.accepted},{rows:6,unsupported:1,future:1,unrecorded:4,accepted:0});
});
test('strict Duke archive rejects eligible malformed or policy-rejected past rows instead of hiding them',()=>{
 for(const [xml,key] of [
  [feed(row({sport:null})),'malformed'],[feed(row({sport:''})),'malformed'],[feed(row({sport:'FB'})),'malformed'],
  [feed(row({start:null})),'malformed'],[feed(row({start:'soon'})),'malformed'],
  [feed(row({end:null})),'malformed'],[feed(row({end:'2026-09-05 21:00:00'})),'malformed'],[feed(row({end:'nope'})),'malformed'],
  [feed(row({id:null})),'malformed'],[feed(row({id:'has space'})),'malformed'],[feed(row({opponent:'  '})),'malformed'],
  [feed(row({archive:null,extra:'<archive_url type="x">https://audio.example/replay/1.mp3</archive_url>'})),'malformed'],
  [feed(row({extra:'<archive_url>https://audio.example/replay/2.mp3</archive_url>'})),'malformed'],
  [feed(row({archive:'https://foreign.example/replay/1.mp3'})),'policyRejected'],
  [feed(row({archive:'https://foreign.example/replay/1.mp3',recorded:'https://audio.example/replay/1.mp3'})),'policyRejected'],
  [feed(row({recorded:'https://foreign.example/replay/1.mp3'})),'policyRejected'],
  [feed(row()+row({id:'g2',archive:'http://audio.example/replay/2.mp3'})),'policyRejected']
 ]) rejects(xml,key);
});
test('strict Duke archive collapses identical duplicates, rejects conflicts and malformed recognized structure',()=>{
 const counts=rowCounts();assert.equal(parseEvents(feed(row(),row()),'archive',NOW,policy,{strict:true,counts}).length,1);assert.equal(counts.duplicateIdentical,1);
 rejects(feed(row(),row({opponent:'Elon'})),'duplicateConflict');
 for(const xml of [feed('<event id="1"><id>g1</id></event>'),feed(row().replace('</event>','')),feed(row().replace('<event>','<event><event>')),
  '<main><events><previous_ev kind="x">'+row()+'</previous_ev></events></main>','<main><events><previous_ev>'+row()+'</previous_ev><previous_ev></previous_ev></events></main>',
  '<main><events><previous_ev>'+row()+'</events></main>',
  // A renamed event element is never an empty or partial success (REVIEW004).
  feed('<renamed_event><id>g2</id></renamed_event>'),feed(row()+'<renamed_event><id>g2</id></renamed_event>'),feed(row(),'<renamed_event><id>g2</id></renamed_event>'),feed(row()+'stray text')]) rejects(xml,'structural');
 for(const xml of ['<main><events><previous_ev>\n  \t</previous_ev><archived_ev/></events></main>','<main><events><previous_ev></previous_ev><archived_ev /></events></main>']) assert.deepEqual(strict(xml),[],'recognized empty, whitespace and self-closing sections stay empty successes');
 assert.equal(strict(`<main><events><previous_ev>\n ${row()}\n</previous_ev></events></main>`).length,1);
});
// Reviewed source exclusions (ARCH-009 amendment), synthetic rows and digests only.
const {excludeReviewedRows}=await import('../lib/archive-source.mjs');
const {createHash}=await import('node:crypto');
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const dukeRules=[{origin:'https://audio.example',pathPrefix:'/replay/',filenamePattern:'^\\d+\\.mp3$'}];
const ex=(over={})=>row({id:'x9',archive:'https://audio.example/replay/renamed.mp3',recorded:'https://audio.example/replay/other.mp3',...over});
const inner=xml=>xml.replace(/^<event>|<\/event>$/g,'');
async function decide(xml,{retainedIds=['old'],digests}={}){
 const counts=rowCounts(),review=[];
 const items=parseEvents(xml,'archive',NOW,policy,{strict:true,counts,review});
 const result=await excludeReviewedRows('duke',items,review,{counts,retainedIds,rules:dukeRules,digests:digests??review.map(r=>sha(r.row))}).then(v=>v,e=>e);
 return {result,counts,review};
}
test('reviewed Duke exclusion hashes the exact inner event XML and keeps every approved row',async()=>{
 const {result,counts,review}=await decide(feed(row()+ex()),{digests:[sha(inner(ex()))]});
 assert.equal(review[0].row,inner(ex()));assert.deepEqual(result.map(e=>e.id),['g1']);assert.deepEqual([counts.sourceExcluded,counts.accepted,counts.policyRejected],[1,1,0]);
 assert.ok(!JSON.stringify(result).includes('renamed'));
});
test('reviewed Duke exclusion fails closed: retained, unknown, changed or partial rows, conflicts, structure and excluded-only',async()=>{
 const fixed=sha(inner(ex()));
 for(const [name,xml,options,key] of [
  ['retained ID',feed(row()+ex()),{retainedIds:['x9']},'policyRejected'],
  ['unknown digest',feed(row()+ex({opponent:'Elon'})),{digests:[fixed]},'policyRejected'],
  ['one address',feed(row()+ex({recorded:''})),{},'policyRejected'],
  ['changed host',feed(row()+ex({archive:'https://evil.example/replay/renamed.mp3'})),{},'policyRejected'],
  ['changed path',feed(row()+ex({archive:'https://audio.example/other/renamed.mp3'})),{},'policyRejected'],
  ['changed scheme',feed(row()+ex({archive:'http://audio.example/replay/renamed.mp3'})),{},'policyRejected'],
  ['collides with approved ID',feed(row()+ex({id:'g1'})),{},'duplicateConflict'],
  ['conflicting duplicates',feed(row()+ex(),ex({opponent:'Elon'})),{},'duplicateConflict'],
  ['excluded-only',feed(ex()),{},'excludedOnly']
 ]){const {result,counts}=await decide(xml,options);assert.ok(result instanceof Error&&result.message==='Archive rows rejected',name);assert.ok(counts[key]>=1,`${name}: ${key}`);}
 const mixed=rowCounts(),review=[];
 assert.throws(()=>parseEvents(feed(row()+ex({recorded:'https://audio.example/replay/2.mp3'})),'archive',NOW,policy,{strict:true,counts:mixed,review}),/rejected/);assert.deepEqual([review.length,mixed.policyRejected],[0,1]);
 for(const xml of [feed(row()+ex({opponent:' '})),feed(row()+ex({sport:'FB'})),feed(row()+ex({end:'nope'})),feed(row()+ex().replace('<event>','<event id="1">'))]) assert.throws(()=>parseEvents(xml,'archive',NOW,policy,{strict:true,review:[]}),/rejected/);
 assert.deepEqual((await decide(feed(''))).result,[],'a recognized empty feed is still a valid empty success');
});
test('strict parsing is opt-in: default archive parsing keeps its existing lossy behavior, errors stay redacted',()=>{
 const mixed=feed(row()+row({id:'g2',archive:'https://foreign.example/secret-token.mp3'})+row({id:'g3',sport:null}));
 assert.deepEqual(parseEvents(mixed,'archive',NOW,policy).map(e=>e.id),['g1']);
 assert.deepEqual(parseEvents(feed('<event id="1"></event>'),'archive',NOW,policy),[]);
 assert.deepEqual(parseEvents(feed(row(),row({opponent:'Elon'})),'archive',NOW,policy).map(e=>e.opponent),['Elon']);
 try{strict(mixed);assert.fail('must reject');}catch(error){assert.ok(!String(error.message+error.stack).includes('foreign.example'));assert.ok(!String(error.message).includes('Tulane'));}
 assert.throws(()=>parseEvents('<main><current_ev></current_ev></main>','live',NOW,policy,{strict:true}),/archives only/);
 const counts=rowCounts();try{parseEvents(mixed,'archive',NOW,policy,{strict:true,counts});}catch{}
 assert.ok(Object.values(counts).every(Number.isInteger));assert.deepEqual([counts.accepted,counts.policyRejected,counts.malformed],[1,1,1]);
});
