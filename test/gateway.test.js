import test from 'node:test';
import assert from 'node:assert/strict';
import { readBackendJSON } from '../lib/backend-json.mjs';
import { metadataGateway, PRODUCTION_ORIGIN } from '../lib/metadata-gateway.mjs';
import worker from '../worker/index.mjs';
import { metadataURL, validateGatewayOrigin } from '../src/gateway.js';
import { createTimingFreshness, nextPollDelay } from '../src/timing-freshness.js';
import { spawnSync } from 'node:child_process';
const uuid = '410422f0-663f-4e3d-82e2-787d954ae29d';
const upstream = url => {
  if (url.includes('/summary?')) return {header:{id:new URL(url).searchParams.get('event'),uid:`s:20~l:23~e:${new URL(url).searchParams.get('event')}`,league:{id:'23',slug:'college-football'},season:{year:2026},competitions:[{id:new URL(url).searchParams.get('event'),competitors:[{team:{id:'150'}},{team:{id:'356'}}]}]},drives:{previous:[],current:{plays:[]}}};
  if (url.includes('/schedule?')) return {team:{id:'150'},season:{year:2026},events:[]};
  if (url.includes('/games/')) return {success:true,games:[]};
  if (url.includes('espn.com')) return {sports:[{leagues:[{teams:[{team:{id:'150',location:'Duke'}}]}]}]};
  return {success:true,teams:[{team_id:uuid,school_name:'Georgia Tech'}]};
};
const makeRequest = (target, options) => new Request(`https://gateway.example${target}`,options);
const fetcher = async url => Response.json(upstream(String(url)));

test('shared router serves exactly five minimized route families and timing age in both deliveries', async () => {
  for (const target of ['/api/homestream/teams',`/api/homestream/games/${uuid}`,'/api/sync/teams','/api/sync/schedule/150/2026','/api/sync/plays/401856671']) {
    let wall = 100000;
    const response = await metadataGateway(makeRequest(target), {fetcher, now:()=>wall++});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    const data = await response.json();
    if (target.includes('/plays/')) { assert.ok(data.checkedAt >= 100000); assert.equal(data.ageMs,null); assert.equal(data.schemaVersion,2); assert.equal(data.eventId,'401856671'); }
    else assert.ok(Array.isArray(data));
  }
});
test('Worker HTTP boundary rejects full queries, encoding, media, hosts, invalid IDs and methods before upstream', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('unexpected fetch'); };
  try {
    for (const target of ['/api/sync/teams?host=evil','/api/sync/teams?','/api/sync/%74eams','/api/sync/plays/1?event=2','/api/sync/plays/https://evil.test','/api/sync/plays/1234567890123',`/api/homestream/games/${'-'.repeat(36)}`,`/api/homestream/games/${uuid}?url=https://evil.test`,'/api/duke','/media/a.m3u8','/api/sync/teams/']) {
      const response = await worker.fetch(makeRequest(target),{ALLOWED_ORIGINS:JSON.stringify([PRODUCTION_ORIGIN])},{});
      assert.equal(response.status,404,target);
    }
    for (const method of ['HEAD','POST','PUT','DELETE']) assert.equal((await worker.fetch(makeRequest('/api/sync/teams',{method}),{ALLOWED_ORIGINS:JSON.stringify([PRODUCTION_ORIGIN])},{})).status,405);
    assert.equal(calls,0);
  } finally { globalThis.fetch = originalFetch; }
});
test('CORS exact origins and restricted preflight are checked without credential forwarding', async () => {
  let calls=0;
  const options={fetcher:async(url, init)=>{
    calls++; assert.equal(init.credentials,'omit'); assert.equal(init.cache,'no-store'); assert.equal(init.redirect,'manual');
    assert.deepEqual(init.headers,{Accept:'application/json'});return fetcher(url);
  }};
  for (const origin of ['null','https://michaeltorbert.github.io.evil.test','https://evil.test','']) assert.equal((await metadataGateway(makeRequest('/api/sync/schedule/150/2026',{headers:{Origin:origin}}),options)).status,403);
  assert.equal(calls,0);
  const headers={Origin:PRODUCTION_ORIGIN,Authorization:'Bearer private',Cookie:'private=1'};
  const response=await metadataGateway(makeRequest('/api/sync/schedule/150/2026',{headers}),options);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),PRODUCTION_ORIGIN);
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'),null);assert.equal(calls,1);
  assert.equal((await metadataGateway(makeRequest('/api/sync/schedule/150/2026'),options)).headers.get('Access-Control-Allow-Origin'),null);
  assert.equal((await metadataGateway(makeRequest('/api/sync/schedule/150/2026',{method:'OPTIONS',headers:{Origin:PRODUCTION_ORIGIN,'Access-Control-Request-Method':'GET'}}),options)).status,204);
  for (const extra of [{'Access-Control-Request-Method':'POST'},{'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'Authorization'}]) assert.equal((await metadataGateway(makeRequest('/api/sync/schedule/150/2026',{method:'OPTIONS',headers:{Origin:PRODUCTION_ORIGIN,...extra}}),options)).status,403);
  assert.equal(calls,2);
});
test('optional cache preserves original check time, recomputes age and CORS, and never serves expired data after failure',async()=>{
  let now=100000,calls=0,stored; const pending=[];
  const cache={match:async()=>stored?.clone(),put:async(key,response)=>{assert.match(key.url,/__metadata_cache_v2/);stored=response;}};
  const options={cache,ctx:{waitUntil:p=>pending.push(p)},now:()=>now,fetcher:async url=>{calls++;return Response.json(upstream(String(url)),{headers:{Date:new Date(now-2000).toUTCString(),Age:'3'}});}};
  const first=await metadataGateway(makeRequest('/api/sync/plays/1',{headers:{Origin:PRODUCTION_ORIGIN}}),options);
  assert.equal((await first.json()).ageMs,4000);await Promise.all(pending);
  assert.equal(stored.headers.get('Access-Control-Allow-Origin'),null);
  now+=5000;
  const hit=await metadataGateway(makeRequest('/api/sync/plays/1'),options);const data=await hit.json();
  assert.equal(data.checkedAt,100000);assert.equal(data.ageMs,9000);assert.equal(calls,1);assert.equal(hit.headers.get('Access-Control-Allow-Origin'),null);
  now+=5000;
  const failure=await metadataGateway(makeRequest('/api/sync/plays/1'),{...options,fetcher:async()=>{throw Error();}});
  assert.equal(failure.status,502);
  const broken={match:async()=>{throw Error();},put:async()=>{throw Error();}};
  assert.equal((await metadataGateway(makeRequest('/api/sync/teams'),{...options,cache:broken})).status,200);await Promise.all(pending);
  now=90000; assert.equal((await metadataGateway(makeRequest('/api/sync/plays/1'),{...options,fetcher:async()=>{throw Error();}})).status,502);
});
test('backend JSON bounds decoded bytes, cancels streams, rejects HTML/schema/redirect errors',async()=>{
  let cancelled=false;
  const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('123456'));},cancel(){cancelled=true;}});
  await assert.rejects(readBackendJSON('https://upstream.test',{fetcher:async()=>new Response(stream,{headers:{'Content-Type':'application/json'}}),maxBytes:5}),/too-large/);
  assert.equal(cancelled,true);
  for (const response of [new Response('<html>error</html>',{headers:{'Content-Type':'text/html'}}),new Response('{broken',{headers:{'Content-Type':'application/json'}}),Response.redirect('https://other.test')]) await assert.rejects(readBackendJSON('https://upstream.test',{fetcher:async()=>response}));
  assert.equal((await metadataGateway(makeRequest('/api/sync/schedule/150/2026'),{fetcher:async()=>Response.json({html:'not schedule'})})).status,502);
  await assert.rejects(readBackendJSON('https://upstream.test',{fetcher:async()=>{throw TypeError('redirect rejected');}}),/redirect rejected/);
  const chunks=['{"name":"','é','"}'].map(s=>new TextEncoder().encode(s));
  assert.deepEqual(await readBackendJSON('https://upstream.test',{fetcher:async()=>new Response(new ReadableStream({start(c){for(const chunk of chunks)c.enqueue(chunk);c.close();}}),{headers:{'Content-Type':'application/json'}})}),{name:'é'});
});
test('backend deadline covers headers and a hanging body, and caller abort cancels body',async()=>{
  const keepAlive=setTimeout(()=>{},1000);
  try {
    await assert.rejects(readBackendJSON('https://upstream.test',{fetcher:()=>new Promise(()=>{}),timeoutMs:15}),{name:'TimeoutError'});
    let cancelled=false;
    const response=()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'application/json'}});
    await assert.rejects(readBackendJSON('https://upstream.test',{fetcher:async()=>response(),timeoutMs:15}),{name:'TimeoutError'});assert.equal(cancelled,true);
    cancelled=false;const controller=new AbortController();const reading=readBackendJSON('https://upstream.test',{fetcher:async()=>response(),signal:controller.signal});
    await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(reading,{name:'AbortError'});assert.equal(cancelled,true);
  } finally {clearTimeout(keepAlive);}
});
test('gateway origin validation and resolution reject explicit invalid configuration, preserving local and Pages paths',()=>{
  const base='https://michaeltorbert.github.io/homecall/';
  assert.equal(metadataURL('sync/teams',base).href,base+'api/sync/teams');
  assert.ok(metadataURL('sync/teams',base) instanceof URL);
  assert.equal(metadataURL('homestream/teams',base,'https://gateway.example').href,'https://gateway.example/api/homestream/teams');
  for(const value of ['http://example.test','https://x.test/','https://x.test/a','https://u:p@x.test','https://x.test?','https://x.test#','https://x.test?x=1','https://x.test#x',' https://x.test','garbage','null'])assert.throws(()=>validateGatewayOrigin(value));
  assert.throws(()=>validateGatewayOrigin('',{required:true}));
  assert.throws(()=>validateGatewayOrigin('http://localhost:8787'));
  assert.equal(validateGatewayOrigin('http://127.0.0.1:8787',{allowLocal:true}),'http://127.0.0.1:8787');
  assert.equal(validateGatewayOrigin('http://[::1]:8787',{allowLocal:true}),'http://[::1]:8787');
});
test('publishing config fails before archive network work for missing or invalid gateway',()=>{
  for (const value of ['', 'https://invalid.example/path']) {
    const result=spawnSync(process.execPath,['scripts/check-gateway.mjs'],{encoding:'utf8',env:{...process.env,REQUIRE_GATEWAY:'true',VITE_GATEWAY_ORIGIN:value}});
    assert.notEqual(result.status,0);assert.match(result.stderr,/VITE_GATEWAY_ORIGIN/);
  }
  const result=spawnSync(process.execPath,['scripts/check-gateway.mjs'],{encoding:'utf8',env:{...process.env,REQUIRE_GATEWAY:'false',VITE_GATEWAY_ORIGIN:''}});assert.equal(result.status,0);
});
test('freshness counts server age, request time and elapsed time without comparing remote clocks',()=>{
  let wall=10000,mono=100;const clock=()=>({wall,mono});const f=createTimingFreshness({clock});
  const start=f.start();wall+=2000;mono+=2000;f.receive({schemaVersion:2,checkedAt:999999999,ageMs:5000},start);
  assert.equal(f.fresh(),true);wall+=37999;mono+=37999;assert.equal(f.fresh(),true);wall++;mono++;assert.equal(f.fresh(),false);
  for (const data of [{checkedAt:1},{checkedAt:1,ageMs:-1},{checkedAt:1,ageMs:Infinity},{ageMs:0},{checkedAt:1,ageMs:1.5}]) {f.receive({schemaVersion:2,...data},f.start());assert.equal(f.fresh(),false);}
  f.receive({schemaVersion:2,checkedAt:1,ageMs:0},f.start());wall+=500;mono+=500;assert.equal(f.fresh(),true);wall-=1;mono+=1;assert.equal(f.fresh(),false);
  f.receive({schemaVersion:2,checkedAt:1,ageMs:0},f.start());wall+=2000;assert.equal(f.fresh(),false);
  f.receive({schemaVersion:2,checkedAt:1,ageMs:0},f.start());f.invalidate();assert.equal(f.fresh(),false);
  assert.deepEqual([nextPollDelay(15000,false),nextPollDelay(30000,false),nextPollDelay(60000,false),nextPollDelay(120000,false),nextPollDelay(120000,true)],[30000,60000,120000,120000,15000]);
});
test('shared gateway distinguishes the full upstream deadline from invalid provider data',async()=>{
 const timeout=new DOMException('Deadline','TimeoutError');
 assert.equal((await metadataGateway(makeRequest('/api/sync/schedule/150/2026'),{fetcher:async()=>{throw timeout;}})).status,504);
 assert.equal((await metadataGateway(makeRequest('/api/sync/schedule/150/2026'),{fetcher:async()=>Response.json({})})).status,502);
});
test('cached timing with unknown upstream age never becomes fresh on cache delivery',async()=>{
 let wall=100000,stored;const pending=[];
 const options={now:()=>wall,fetcher,cache:{match:async()=>stored?.clone(),put:async(key,response)=>{assert.match(key.url,/__metadata_cache_v2/);stored=response;}},ctx:{waitUntil:p=>pending.push(p)}};
 const first=await metadataGateway(makeRequest('/api/sync/plays/1'),options);
 assert.equal((await first.json()).ageMs,null);await Promise.all(pending);wall+=5000;
 const hit=await metadataGateway(makeRequest('/api/sync/plays/1'),{...options,fetcher:async()=>{throw Error('cache should avoid upstream');}});
 assert.equal(hit.status,200);assert.equal((await hit.json()).ageMs,null);
});
