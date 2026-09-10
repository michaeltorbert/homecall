import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEvents,safeAudioURL} from '../lib/duke-source.mjs';
const event=(id,start,end)=>`<event><id>${id}</id><start_timestamp>${start}</start_timestamp><end>${end}</end><sport_id>1</sport_id><opponent>North &amp; South</opponent><url>https://learfield-gd.leanstream.co/IM3501-MP3?sport=FB</url></event>`;
test('expired current flags cannot produce live events',()=>{
 const xml=`<main><events><current_ev>${event('old',1,'1970-01-01 00:00:20')}</current_ev><upcoming_ev>${event('next',200,'1970-01-01 00:05:00')}</upcoming_ev></events></main>`;
 const result=parseEvents(xml,'live',100000);
 assert.equal(result.length,1);assert.equal(result[0].status,'upcoming');assert.equal(result[0].opponent,'North & South');
});
test('source selection rejects foreign streams and credential-bearing URLs',()=>{
 for(const url of ['http://learfield-gd.leanstream.co/IM3501-MP3','https://evil.example/a.mp3','https://user:pass@learfield-gd.leanstream.co/IM3501-MP3','https://s3.amazonaws.com/other-bucket/a.mp3']) assert.equal(safeAudioURL(url),null);
 assert.ok(safeAudioURL('https://s3.amazonaws.com/archive.leanplayer.com/gameday/1788631200_35_70596105.mp3'));
});
test('XML entities are not evaluated',()=>assert.throws(()=>parseEvents('<!DOCTYPE x><main></main>','live')));
