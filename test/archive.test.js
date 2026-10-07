import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReplayURL, normalizeVT, createCatalog } from '../lib/archive-source.mjs';
import { seekReplay, stopReplay, filterReplays, catalogFreshness } from '../src/replay.js';
import { rowCounts } from '../lib/duke-source.mjs';
const rules={vt:[{origin:'https://audio.example',pathPrefix:'/gameday/',filenamePattern:'^\\d+_9004_\\d+\\.mp3$'}]};
const url = 'https://audio.example/gameday/1788645600_9004_37219319.mp3';
test('archive accepts only recordings for the selected school', () => {
  assert.equal(safeReplayURL(url,'vt',rules),url);
  for (const value of [url.replace('https:','http:'),url+'?token=x',url.replace('9004','35'),'https://audio.example/live',url.replace('audio.example','evil.example')]) assert.equal(safeReplayURL(value,'vt',rules),null);
});
test('VT handles singleton events, deduplicates and labels shows without importing scores', () => {
  const event = {id:'a',opponent:'Tech Talk Live',start_timestamp:'1788645600',sport_id:'159',archive_url:url,score:'10-0'};
  const data = {sports:{sport:[{id:'159',name:'Tech Talk Live',is_show:'1'}]},events:{previous_ev:{event},archived_ev:{event:[event,{...event,id:'future',start_timestamp:'9999999999'}]}}};
  const result = normalizeVT(data, Date.now(),rules);
  assert.equal(result.length,1); assert.equal(result[0].kind,'Show'); assert.equal(result[0].score,undefined);
});
test('source failures produce explicit unavailability independently of external fallback', async () => {
  const data = await createCatalog(async () => { throw Error('offline'); });
  assert.equal(data.schools.duke.status,'unavailable'); assert.equal(data.schools.vt.status,'unavailable'); assert.equal(data.schools.miami.status,'external');
});
test('seeking clamps endpoints and rejects unknown duration', () => {
  const audio = {duration:100,currentTime:1};
  seekReplay(audio,-15); assert.equal(audio.currentTime,0);
  seekReplay(audio,200); assert.equal(audio.currentTime,100);
  audio.duration=Infinity; assert.equal(seekReplay(audio,1),false);
});
test('stop unloads recording, and filters intersect sport/year', () => {
  const calls=[]; stopReplay({pause:()=>calls.push('pause'),removeAttribute:x=>calls.push(x),load:()=>calls.push('load')});
  assert.deepEqual(calls,['pause','src','load']);
  const items=[{sport:'Football',start:'2026-09-05'},{sport:'Football',start:'2025-09-05'},{sport:'Basketball',start:'2026-02-01'}];
  assert.deepEqual(filterReplays(items,'Football','2026'),[items[0]]);
});
test('source body size limit cancels oversized streaming response',async()=>{
  const {readSource}=await import('../lib/archive-source.mjs');
  let canceled=false;
  const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(1_000_001));},cancel(){canceled=true;}});
  await assert.rejects(readSource('https://feed.example/archive',async()=>new Response(stream)),/too large/);
  assert.equal(canceled,true);
});
test('source deadline cancels a hanging body and rejects manual redirects',async()=>{
 const {readSource}=await import('../lib/archive-source.mjs');let canceled=false;
 await assert.rejects(readSource('https://feed.example/archive',async(_url,options)=>{assert.equal(options.redirect,'manual');return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){canceled=true;}}));},{timeoutMs:10}),{name:'TimeoutError'});assert.equal(canceled,true);
 await assert.rejects(readSource('https://feed.example/archive',async()=>Response.redirect('https://evil.example')));
 await assert.rejects(readSource('https://feed.example/archive',()=>new Promise(()=>{}),{timeoutMs:10}),{name:'TimeoutError'});
});
test('Duke permits signed query only on the configured exact feed',async()=>{
 const {fetchArchive}=await import('../lib/archive-source.mjs');
 const config={dukePlayer:'https://player.example/',dukeFeedPath:'/previous.xml',replayRules:{duke:[]}};
 const calls=[];
 const result=await fetchArchive('duke',async url=>{calls.push(url);return new Response(calls.length===1?'previous: "https://player.example/previous.xml?signature=fixture"':'<main><previous_ev></previous_ev></main>');},config);
 assert.deepEqual(result,[]);assert.equal(calls[1],'https://player.example/previous.xml?signature=fixture');
 await assert.rejects(fetchArchive('duke',async()=>new Response('previous: "https://evil.example/previous.xml?signature=fixture"'),config),/Unexpected feed/);
});

// Strict archive refresh parsing (issue #4): synthetic rows of the known VT feed contract only.
const NOW=Date.parse('2026-09-10T00:00:00Z');
const sportsTable=[{id:'1',name:'Football',is_show:'0'},{id:'159',name:' Tech Talk Live ',is_show:'1'}];
const vtRow=(over={})=>({id:'a',opponent:'Tulane',start_timestamp:'1788645600',sport_id:'1',archive_url:url,...over});
const vt=(previous,archived)=>({sports:{sport:sportsTable},events:{previous_ev:previous===undefined?undefined:{event:previous},archived_ev:archived===undefined?undefined:{event:archived}}});
const strictVT=data=>normalizeVT(data,NOW,rules,{strict:true});
function vtRejects(data,key){const counts=rowCounts();assert.throws(()=>normalizeVT(data,NOW,rules,{strict:true,counts}),/^Error: Archive rows rejected$/);assert.ok(counts[key]>=1,key);}
test('strict VT accepts valid, genuinely empty and legitimately excluded rows with trimmed structural labels',()=>{
 const show=strictVT(vt([vtRow({sport_id:'159',opponent:' Live show '})]));
 assert.deepEqual(show.map(({sport,kind,opponent})=>({sport,kind,opponent})),[{sport:'Tech Talk Live',kind:'Show',opponent:'Live show'}]);
 assert.equal(strictVT(vt([vtRow()]))[0].kind,'Game recording');
 for(const empty of [{sports:{sport:[]},events:{previous_ev:'',archived_ev:{}}},{sports:{sport:[]},events:{archived_ev:null}},vt([],[]),vt(undefined,'')]) assert.deepEqual(strictVT(empty),[]);
 const counts=rowCounts();
 assert.deepEqual(normalizeVT(vt([vtRow({id:'f',start_timestamp:String(NOW/1000+60)}),vtRow({id:'n',archive_url:''}),vtRow({id:'o',archive_url:{}}),vtRow({id:'z',archive_url:null,sport_id:'404'})]),NOW,rules,{strict:true,counts}),[]);
 assert.deepEqual([counts.rows,counts.future,counts.unrecorded],[4,1,3]);
});
test('strict VT rejects unmapped sports, wrong collection types, policy-rejected and conflicting rows',()=>{
 for(const [data,key] of [
  [vt([vtRow({sport_id:'404'})]),'malformed'],[vt([vtRow({sport_id:undefined})]),'malformed'],
  [vt([vtRow({start_timestamp:undefined})]),'malformed'],[vt([vtRow({start_timestamp:'soon'})]),'malformed'],
  [vt([vtRow({id:undefined})]),'malformed'],[vt([vtRow({opponent:' '})]),'malformed'],[vt([vtRow({archive_url:42})]),'malformed'],
  [{sports:{sport:[{id:'1',name:''}]},events:{previous_ev:{event:[vtRow()]}}},'malformed'],
  [vt([vtRow({archive_url:url.replace('9004','35')})]),'policyRejected'],
  [vt([vtRow({archive_url:url.replace('audio.example','evil.example'),recorded_url:url})]),'policyRejected'],
  [vt([vtRow(),vtRow({id:'b',archive_url:url+'?token=x'})]),'policyRejected'],
  [vt([vtRow()],[vtRow({opponent:'Elon'})]),'duplicateConflict'],
  [vt('not-events'),'structural'],[vt([vtRow(),'row']),'structural'],
  [{sports:{sport:sportsTable},events:{previous_ev:[vtRow()]}},'structural'],
  // Missing or renamed section/event containers are never an empty success.
  [{sports:{sport:sportsTable},events:{}},'structural'],
  [{sports:{sport:sportsTable},events:{renamed_previous:{event:[vtRow()]}}},'structural'],
  [{sports:{sport:sportsTable},events:{previous_ev:{renamed_event:[vtRow()]}}},'structural'],
  [{sports:{sport:sportsTable},events:{previous_ev:{event:[]},archived_ev:{renamed_event:[vtRow()]}}},'structural']
 ]) vtRejects(data,key);
 assert.throws(()=>strictVT({sports:{sport:sportsTable},events:[]}),/Unexpected archive format/);
 const counts=rowCounts();assert.equal(normalizeVT(vt([vtRow()],[vtRow()]),NOW,rules,{strict:true,counts}).length,1);assert.equal(counts.duplicateIdentical,1);
});
test('default VT normalization is unchanged by the strict option',()=>{
 const mixed=vt([vtRow(),vtRow({id:'b',sport_id:'404'}),vtRow({id:'c',archive_url:url.replace('9004','35')})],{event:'x'});
 assert.deepEqual(normalizeVT(mixed,NOW,rules).map(e=>e.id),['a']);
 assert.deepEqual(normalizeVT(vt([vtRow()],[vtRow({opponent:'Elon'})]),NOW,rules)[0].opponent,'Elon');
 assert.equal(normalizeVT(vt([vtRow({sport_id:'159'})]),NOW,rules)[0].sport,' Tech Talk Live ');
});
test('fetchArchive is strict only through its fifth argument; createCatalog and default calls keep existing behavior',async()=>{
 const {fetchArchive}=await import('../lib/archive-source.mjs');
 const config={vtFeed:'https://feed.example/vt',replayRules:rules};
 const fetcher=async()=>new Response(JSON.stringify({data:vt([vtRow(),vtRow({id:'b',archive_url:url.replace('9004','35')})])}));
 assert.deepEqual((await fetchArchive('vt',fetcher,config,NOW)).map(e=>e.id),['a']);
 assert.deepEqual((await createCatalog(fetcher,config,NOW)).schools.vt.items.map(e=>e.id),['a']);
 const counts=rowCounts();
 await assert.rejects(fetchArchive('vt',fetcher,config,NOW,{strict:true,counts}),/^Error: Archive rows rejected$/);
 assert.deepEqual([counts.accepted,counts.policyRejected],[1,1]);
});
// Reviewed source exclusions (ARCH-009 amendment). Production digests are fixed; these synthetic
// rows are exercised through the internal decision helper with their own synthetic digests.
const {excludeReviewedRows}=await import('../lib/archive-source.mjs');
const {createHash}=await import('node:crypto');
const sortedJSON=v=>JSON.stringify(function sort(x){return Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;}(v));
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const badName=url.replace('1788645600_9004_37219319','renamed-recording');
const exRow=(over={})=>vtRow({id:'x',archive_url:badName,recorded_url:badName.replace('renamed','other'),...over});
async function decideVT(data,{retainedIds=['old'],digests}={}){
 const counts=rowCounts(),review=[];
 const items=normalizeVT(data,NOW,rules,{strict:true,counts,review});
 const result=await excludeReviewedRows('vt',items,review,{counts,retainedIds,rules:rules.vt,digests:digests??review.map(r=>sha(sortedJSON(r.row)))}).then(v=>v,e=>e);
 return {result,counts};
}
test('reviewed VT exclusion: exact full-row digest, both filename-only addresses, not retained, approved rows still publish',async()=>{
 const {result,counts}=await decideVT(vt([vtRow(),exRow()]));
 assert.deepEqual(result.map(e=>e.id),['a']);assert.deepEqual([counts.sourceExcluded,counts.policyRejected,counts.accepted],[1,0,1]);
 assert.ok(!JSON.stringify(result).includes('renamed'),'the excluded row is never published');
 const key=sortedJSON(exRow());assert.equal((await decideVT(vt([vtRow(),exRow()]),{digests:[sha(key)]})).counts.sourceExcluded,1,'canonical form is the key-sorted original object');
});
test('reviewed VT exclusion fails closed for every other case',async()=>{
 const fixed=sha(sortedJSON(exRow()));
 const cases=[
  ['retained ID',vt([vtRow(),exRow()]),{retainedIds:['x']},'policyRejected'],
  ['no retained list',vt([vtRow(),exRow()]),{retainedIds:null},'policyRejected'],
  ['unknown digest',vt([vtRow(),exRow({opponent:'Elon'})]),{digests:[fixed]},'policyRejected'],
  ['one address only',vt([vtRow(),exRow({recorded_url:undefined})]),{},'policyRejected'],
  ['changed host',vt([vtRow(),exRow({archive_url:badName.replace('audio.example','evil.example')})]),{},'policyRejected'],
  ['changed path',vt([vtRow(),exRow({archive_url:badName.replace('/gameday/','/other/')})]),{},'policyRejected'],
  ['changed scheme',vt([vtRow(),exRow({archive_url:badName.replace('https:','http:')})]),{},'policyRejected'],
  ['query string',vt([vtRow(),exRow({archive_url:badName+'?token=x'})]),{},'policyRejected'],
  ['not mp3',vt([vtRow(),exRow({archive_url:badName.replace('.mp3','.aac')})]),{},'policyRejected'],
  ['ID collides with an approved row',vt([vtRow(),exRow({id:'a'})]),{},'duplicateConflict'],
  ['conflicting excluded duplicates',vt([vtRow(),exRow()],[exRow({opponent:'Elon'})]),{},'duplicateConflict'],
  ['excluded-only result',vt([exRow()]),{},'excludedOnly']
 ];
 for(const [name,data,options,key] of cases){const {result,counts}=await decideVT(data,options);assert.ok(result instanceof Error&&/^Archive rows rejected$/.test(result.message),name);assert.ok(counts[key]>=1,`${name}: ${key}`);}
 // Mixed valid/rejected alternatives are never deferred for exclusion.
 const mixed=rowCounts(),review=[];assert.throws(()=>normalizeVT(vt([vtRow(),exRow({recorded_url:url})]),NOW,rules,{strict:true,counts:mixed,review}),/rejected/);assert.deepEqual([review.length,mixed.policyRejected],[0,1]);
 // Malformed fields and structure fail before any exclusion decision.
 for(const data of [vt([vtRow(),exRow({opponent:' '})]),vt([vtRow(),exRow({sport_id:'404'})]),vt([vtRow(),exRow({start_timestamp:'soon'})]),{sports:{sport:sportsTable},events:{previous_ev:{renamed_event:[exRow()]}}}]){const review=[];assert.throws(()=>normalizeVT(data,NOW,rules,{strict:true,review}),/rejected/);}
 const identical=await decideVT(vt([vtRow(),exRow()],[exRow()]));assert.deepEqual([identical.result.map(e=>e.id),identical.counts.duplicateIdentical,identical.counts.sourceExcluded],[['a'],1,1]);
 assert.deepEqual((await decideVT(vt([],[]))).result,[],'a recognized empty feed is still a valid empty success');
});
test('fetchArchive uses only the fixed reviewed digests; caller-supplied exclusions are ignored',async()=>{
 const {fetchArchive}=await import('../lib/archive-source.mjs');
 const data=vt([vtRow(),exRow()]),fetcher=async()=>new Response(JSON.stringify({data}));
 const counts=rowCounts();
 await assert.rejects(fetchArchive('vt',fetcher,{vtFeed:'https://feed.example/vt',replayRules:rules},NOW,{strict:true,counts,retainedIds:[],digests:[sha(sortedJSON(exRow()))],review:[]}),/^Error: Archive rows rejected$/);
 assert.deepEqual([counts.sourceExcluded,counts.policyRejected,counts.accepted],[0,1,1]);
 assert.deepEqual((await fetchArchive('vt',fetcher,{vtFeed:'https://feed.example/vt',replayRules:rules},NOW)).map(e=>e.id),['a'],'default behavior unchanged');
});
test('catalog freshness: inclusive five-minute future skew, more than twelve hours old, otherwise unknown',()=>{
 const at='2026-09-10T00:00:00.000Z',t=Date.parse(at),m=60_000,h=60*m;
 assert.equal(catalogFreshness(at,t-5*m+1),'current');assert.equal(catalogFreshness(at,t-5*m),'current');assert.equal(catalogFreshness(at,t-5*m-1),'unknown');
 assert.equal(catalogFreshness(at,t+12*h-1),'current');assert.equal(catalogFreshness(at,t+12*h),'current');assert.equal(catalogFreshness(at,t+12*h+1),'old');
 for(const bad of [undefined,'',null,'not a date',42]) assert.equal(catalogFreshness(bad,t),'unknown');
});
