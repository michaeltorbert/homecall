import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReplayURL, normalizeVT, createCatalog } from '../lib/archive-source.mjs';
import { seekReplay, stopReplay, filterReplays } from '../src/replay.js';
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
