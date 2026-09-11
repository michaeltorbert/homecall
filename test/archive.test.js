import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReplayURL, normalizeVT, createCatalog } from '../lib/archive-source.mjs';
import { seekReplay, stopReplay, filterReplays } from '../src/replay.js';
const url = 'https://ais-aod.leanstream.co/gameday/1788645600_9004_37219319.mp3';
test('archive accepts only recordings for the selected school', () => {
  assert.equal(safeReplayURL(url,'vt'),url);
  for (const value of [url.replace('https:','http:'),url+'?token=x',url.replace('9004','35'),'https://learfield-gd.leanstream.co/IM3501-MP3',url.replace('ais-aod.leanstream.co','evil.example')]) assert.equal(safeReplayURL(value,'vt'),null);
});
test('VT handles singleton events, deduplicates and labels shows without importing scores', () => {
  const event = {id:'a',opponent:'Tech Talk Live',start_timestamp:'1788645600',sport_id:'159',archive_url:url,score:'10-0'};
  const data = {sports:{sport:[{id:'159',name:'Tech Talk Live',is_show:'1'}]},events:{previous_ev:{event},archived_ev:{event:[event,{...event,id:'future',start_timestamp:'9999999999'}]}}};
  const result = normalizeVT(data);
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
