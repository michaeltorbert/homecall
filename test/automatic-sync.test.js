import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {estimateRadioPosition,AutomaticSyncTracker,playbackTarget} from '../src/automatic-sync.js';
import {extractRadioClockCandidates,associateRadioPeriods} from '../src/radio-index.js';
const anchor=(audioTime,clock,extra={})=>({id:`a-${audioTime}`,streamId:'s',audioTime,clock,period:2,reportedClockState:'running',provenance:{kind:'asr-clock-mention'},...extra});
const anchors=[anchor(100,98),anchor(126.5,72)];
const observation={period:2,clock:85,running:true,capturedAt:20};
test('running clock sequence estimates real-time position, never measured accuracy',()=>{
 const r=estimateRadioPosition(observation,anchors,{streamId:'s'});
 assert.equal(r.state,'estimated');assert.equal(r.canApply,true);assert.equal(r.audioTime,113.25);
 assert.equal(r.disagreementSeconds,.5);assert.equal(r.timingAccuracy,'unmeasured');
});
test('stops, reversed clock, stale history, duplicate windows, and conflicting periods cannot sync',()=>{
 for(const data of [[anchor(100,98),anchor(150,72)],[anchor(100,72),anchor(126,98)],
 [anchor(100,98),anchor(126,72,{reportedClockState:'stopped'})],[anchor(100,98),anchor(126,72,{period:3})],
 [anchor(100,98),anchor(100.2,98)]]) assert.equal(estimateRadioPosition(observation,data,{streamId:'s'}).canApply,false);
 assert.equal(estimateRadioPosition(observation,anchors,{streamId:'s',oldestAudioTime:101}).canApply,false);
 assert.equal(estimateRadioPosition({...observation,running:false},anchors,{streamId:'s'}).canApply,false);
 assert.equal(estimateRadioPosition({...observation,clock:60},anchors,{streamId:'s'}).canApply,false);
 assert.equal(estimateRadioPosition(observation,anchors,{streamId:'other'}).canApply,false);
});
test('two distinct matching radio passages are ambiguous',()=>{
 const r=estimateRadioPosition(observation,[...anchors,anchor(200,98),anchor(226,72)],{streamId:'s'});
 assert.equal(r.state,'ambiguous');assert.equal(r.canApply,false);
});
test('camera confirmation requires multiple time-consistent readings and resets on a jump',()=>{
 const tracker=new AutomaticSyncTracker();
 assert.equal(tracker.observe({...observation,clock:90,capturedAt:20},anchors,{streamId:'s'}).canApply,false);
 assert.equal(tracker.observe({...observation,clock:89,capturedAt:21},anchors,{streamId:'s'}).canApply,false);
 assert.equal(tracker.observe({...observation,clock:88,capturedAt:22},anchors,{streamId:'s'}).canApply,true);
 assert.equal(tracker.observe({...observation,clock:74,capturedAt:23},anchors,{streamId:'s'}).canApply,false);
});

test('the final camera digit cannot alone shift playback by one second',()=>{
 const tracker=new AutomaticSyncTracker();
 tracker.observe({...observation,clock:90,capturedAt:20},anchors,{streamId:'s'});
 tracker.observe({...observation,clock:89,capturedAt:21},anchors,{streamId:'s'});
 const result=tracker.observe({...observation,clock:87,capturedAt:22},anchors,{streamId:'s'});
 assert.equal(result.canApply,true);assert.equal(result.audioTime,110.25);
});

test('TV beyond analyzed coverage gets actionable guidance and conflicting ASR stays ambiguous',()=>{
 const late=estimateRadioPosition({...observation,clock:60},anchors,{streamId:'s'});
 assert.equal(late.state,'needs-more-lead');assert.match(late.reason,/pause the TV/);
 const conflict=estimateRadioPosition(observation,[anchors[0],anchor(100.2,97),anchors[1]],{streamId:'s'});
 assert.equal(conflict.canApply,false);assert.equal(conflict.state,'ambiguous');
});
test('actual Duke radio creates a consistent automatic estimate; TV accuracy remains unmeasured',(t)=>{
 if(!fs.existsSync(new URL('../output/tulane-game-transcript.json',import.meta.url))) {t.skip('Optional local broadcast transcript is not distributed with the code');return;}
 const transcript=JSON.parse(fs.readFileSync(new URL('../output/tulane-game-transcript.json',import.meta.url)));
 const raw=extractRadioClockCandidates(transcript.chunks,{streamId:'duke-tulane',sport:'football'});
 const candidates=associateRadioPeriods(raw,{streamId:'duke-tulane',sport:'football'});
 const result=estimateRadioPosition({period:2,clock:85,running:true},candidates,{streamId:'duke-tulane'});
 assert.equal(result.canApply,true);
 assert.ok(Math.abs(result.audioTime-230.47)<.02);
 assert.ok(Math.abs(result.disagreementSeconds-.54)<.02);
 assert.equal(result.timingAccuracy,'unmeasured');
 for(const period of [1,3,4,99]) assert.equal(estimateRadioPosition({period,clock:85,running:true},candidates,{streamId:'duke-tulane'}).canApply,false);
 assert.equal(estimateRadioPosition({period:2,clock:85,running:true},raw.filter(c=>c.reportedClockState==='running'),{streamId:'duke-tulane'}).canApply,false);
});

test('unknown radio period cannot be borrowed from any camera period',()=>{
 const unknown=anchors.map(a=>({...a,period:null}));
 for(const period of [1,2,3,4,99]) assert.equal(estimateRadioPosition({...observation,period},unknown,{streamId:'s'}).canApply,false);
});

test('a women’s basketball half is not treated as a numbered quarter',()=>{
 const candidates=extractRadioClockCandidates([{text:'1:30 remaining in the second half',timestamp:[1,2]}],{streamId:'women',sport:'womens-basketball'});
 assert.equal(candidates.length,1);assert.equal(candidates[0].period,null);
});

test('short-window recognition of real Duke audio retains a usable radio-only period chain',(t)=>{
 if(!fs.existsSync(new URL('../output/tulane-stream-windows.json',import.meta.url))) {t.skip('Optional local broadcast transcript is not distributed with the code');return;}
 const transcript=JSON.parse(fs.readFileSync(new URL('../output/tulane-stream-windows.json',import.meta.url)));
 const raw=[];
 for(const window of transcript.windows) {
  for(const candidate of extractRadioClockCandidates(window.chunks,{streamId:'stream-windows',startSampleTime:window.start,sport:'football'})) {
   if(candidate.audioEndTime>window.start+window.duration || raw.some(c=>c.clock===candidate.clock && Math.abs(c.audioTime-candidate.audioTime)<3)) continue;
   raw.push(candidate);
  }
 }
 const candidates=associateRadioPeriods(raw,{streamId:'stream-windows',sport:'football'});
 const result=estimateRadioPosition({period:2,clock:85,running:true},candidates,{streamId:'stream-windows',oldestAudioTime:70,newestAudioTime:250});
 assert.equal(result.canApply,true);assert.ok(Math.abs(result.audioTime-230.44)<.02);
 for(const period of [1,3,4]) assert.equal(estimateRadioPosition({period,clock:85,running:true},candidates,{streamId:'stream-windows'}).canApply,false);
});

test('OCR processing and speaker latency advance the playback target in the correct direction',()=>{
 assert.equal(playbackTarget({audioTime:100,capturedAt:10},{now:11,outputDelay:.2}),101.2);
 assert.equal(playbackTarget({audioTime:100,capturedAt:10},{now:16,outputDelay:.2}),null);
 assert.equal(playbackTarget({audioTime:100,capturedAt:10},{now:9,outputDelay:.2}),null);
 assert.equal(playbackTarget({audioTime:100,capturedAt:10,referenceTimes:[90,101]},{now:11,outputDelay:.2}),null);
});
