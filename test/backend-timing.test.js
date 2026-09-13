import test from 'node:test';
import assert from 'node:assert/strict';
import { representationAge, readBackendSnapshot } from '../lib/backend-json.mjs';
import { browserTiming } from '../src/timing-transport.js';
const now = Date.parse('2026-09-13T02:00:10Z');
const headers = values => new Headers(values);
const summary = () => ({header:{id:'123',uid:'s:20~l:23~e:123',league:{id:'23',slug:'college-football'},season:{year:2026},competitions:[{id:'123',competitors:[{team:{id:'59'}},{team:{id:'2633'}}]}]},drives:{previous:[]}});
test('representation age includes upstream Age, request delay and Date precision, never receipt-only age',()=>{
 const date = new Date(now-5000).toUTCString();
 assert.equal(representationAge(headers({Date:date}),now-250,now),6000);
 assert.equal(representationAge(headers({Date:date,Age:'20'}),now-250,now),21250);
 assert.equal(representationAge(headers({Date:new Date(now).toUTCString()}),now-250,now),1250);
 for (const value of [{},{Age:'0'},{Date:'garbage'},{Date:date,Age:'-1'},{Date:date,Age:'0.5'},{Date:date,Age:'9007199254740991'},{Date:new Date(now+2000).toUTCString()}]) assert.equal(representationAge(headers(value),now-250,now),null);
 assert.equal(representationAge(headers({Date:date}),now+1,now),null);
});
test('diagnostics classify refusal without exposing bodies, URLs, headers or raw error text',async()=>{
 const records=[];
 await assert.rejects(readBackendSnapshot('https://example.test/?secret=private',{now:()=>now,diagnostic:r=>records.push(r),fetcher:async()=>new Response('private body',{status:403,headers:{'Content-Type':'text/html','Set-Cookie':'private'}})}));
 assert.deepEqual(records,[{stage:'headers',status:403,type:'html',bytes:0,elapsedMs:0,failure:'invalid-response'}]);
 records.length=0;
 await assert.rejects(readBackendSnapshot('https://example.test',{now:()=>now,diagnostic:r=>records.push(r),fetcher:async()=>{throw Error('private network context');}}));
 assert.equal(records[0].failure,'network-or-runtime');
 assert.ok(!JSON.stringify(records).includes('private'));
 const snapshot=await readBackendSnapshot('https://example.test',{now:()=>now,diagnostic(){throw Error();},fetcher:async()=>Response.json({value:1})});
 assert.deepEqual(snapshot,{data:{value:1},receivedAt:now,ageMs:null});
});
test('browser alternative is narrow, anonymous and identity-checked, always unknown-age even with readable Date',async()=>{
 let calls=0;
 const fetcher=async(url,init)=>{
  calls++; assert.equal(url,'https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=123');
  assert.equal(init.credentials,'omit');assert.equal(init.redirect,'manual');
  return Response.json(summary(),{headers:{Date:new Date(now).toUTCString(),Age:'0'}});
 };
 const result=await browserTiming('sync/plays/123',{fetcher,now:()=>now});
 assert.equal(result.schemaVersion,2);assert.equal(result.eventId,'123');assert.equal(result.ageMs,null);
 for(const path of ['sync/teams','https://evil.test','sync/plays/123?url=evil','sync/plays/%31']) await assert.rejects(browserTiming(path,{fetcher}));
 assert.equal(calls,1);
 await assert.rejects(browserTiming('sync/plays/456',{fetcher:async()=>Response.json(summary())}),/identity/);
});
