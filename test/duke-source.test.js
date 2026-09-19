import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEvents,safeAudioURL} from '../lib/duke-source.mjs';
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
