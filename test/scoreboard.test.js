import test from 'node:test';
import assert from 'node:assert/strict';
import {parseScoreboard,runningObservation} from '../src/scoreboard.js';
test('camera clock extraction distinguishes period and down marker',()=>{
 assert.deepEqual(parseScoreboard('DUKE 7 TULANE 0 Q2 1:38'),{state:'read',clock:98,period:2});
 assert.equal(parseScoreboard('DUKE 7 TULANE 0 2ND & 7 1:38').state,'period-missing');
 assert.deepEqual(parseScoreboard('DUKE 30 UNC 22 1st HALF 12:30','basketball'),{state:'read',clock:750,period:1});
});
test('camera rejects ambiguous clocks and impossible quarter clock',()=>{
 assert.equal(parseScoreboard('Q2 1:38 0:25').state,'ambiguous');
 assert.equal(parseScoreboard('Q2 18:38').state,'unreadable');
 assert.equal(parseScoreboard('Q2 12:38','womens-basketball').state,'unreadable');
});
test('basketball fractional subminute clocks preserve tenths without duplicating a minute clock',()=>{
 for(const clock of [':45.3','45.3','0:45.3']) assert.deepEqual(parseScoreboard(`DUKE 30 UNC 22 2nd HALF ${clock}`,'basketball'),{state:'read',clock:45.3,period:2});
 assert.equal(parseScoreboard('DUKE Q4 :45.3 4.2','womens-basketball').state,'ambiguous');
});
test('clock movement uses capture time, and rejects stops and discontinuities',()=>{
 const previous={state:'read',clock:98,period:2,capturedAt:10};
 assert.equal(runningObservation(previous,{...previous,clock:97,capturedAt:11}).running,true);
 assert.equal(runningObservation(previous,{...previous,capturedAt:11}).running,false);
 assert.equal(runningObservation(previous,{...previous,clock:40,capturedAt:11}).running,false);
 assert.equal(runningObservation(previous,{...previous,clock:97,period:3,capturedAt:11}).running,false);
});
