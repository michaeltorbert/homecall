import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPlaylist, mediaURL } from '../src/homestream.js';
const origin='https://gateway.example',url=origin+'/media/game/team/one';
const manifest=(seq=10,ended=false)=>`#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:${seq}\n#EXTINF:1,\nsegment_${seq}.ts\n${ended?'#EXT-X-ENDLIST':''}`;
test('availability checks distinguish advancing, frozen, ended, missing and invalid media',async()=>{
 async function probe(items){return checkPlaylist(url,{origin,sleep:async()=>{},fetcher:async()=>{const x=items.shift();return typeof x==='number'?{ok:false,status:x}:{ok:true,text:async()=>x};}})}
 assert.equal(await probe([manifest(10),manifest(13)]),'ready');
 assert.equal(await probe([manifest(10),manifest(10)]),'stalled');
 assert.equal(await probe([manifest(10,true)]),'ended');
 assert.equal(await probe([404]),'missing');assert.equal(await probe([403]),'unavailable');
 assert.equal(await probe(['<html>error</html>']),'unavailable');
 assert.equal(await checkPlaylist(null),'unpublished');
});
test('canceling a playlist check cannot yield a ready obsolete source',async()=>{
 const c=new AbortController();
 await assert.rejects(checkPlaylist(url,{origin,signal:c.signal,fetcher:async()=>({ok:true,text:async()=>manifest()}),sleep:async()=>{c.abort();throw c.signal.reason;}}),{name:'AbortError'});
});

test('public relay validation rejects upstream, wrong origin, credentials, query and malformed paths',()=>{
 assert.equal(mediaURL(url,{origin}),url);
 for(const value of ['https://upstream.example/live.m3u8',url+'?url=hidden',url+'#fragment',url.replace('gateway.example','evil.example'),url.replace('gateway.example','user:pass@gateway.example'),origin+'/media/game/team/../one',origin+'/media/game/team/%6fne']) assert.equal(mediaURL(value,{origin}),null);
});
test('invalid media causes no browser request',async()=>{
 let requests=0;assert.equal(await checkPlaylist('https://upstream.example/live.m3u8',{origin,fetcher:async()=>{requests++}}),'unpublished');assert.equal(requests,0);
});

test('master traversal probes the same advancing relay media playlist twice',async()=>{
 const child=origin+'/media/resource/opaque-token',requests=[];let sequence=10;
 const result=await checkPlaylist(url,{origin,sleep:async()=>{},fetcher:async address=>{requests.push(address);return {ok:true,text:async()=>address===url?`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\n${child}\n`:manifest(sequence++)};}});
 assert.equal(result,'ready');assert.deepEqual(requests,[url,child,child]);
});
test('master traversal rejects foreign/query children and stops after three descendants',async()=>{
 for(const child of ['https://upstream.example/variant.m3u8',origin+'/media/resource/token?target=x']){
  let requests=0;assert.equal(await checkPlaylist(url,{origin,fetcher:async()=>{requests++;return {ok:true,text:async()=>`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\n${child}\n`};}}),'unavailable');assert.equal(requests,1);
 }
 let requests=0;assert.equal(await checkPlaylist(url,{origin,fetcher:async()=>({ok:true,text:async()=>`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\n${origin}/media/resource/token${++requests}\n`})}),'unavailable');assert.equal(requests,4);
});
test('master traversal accepts the directory-capability playlist form and still rejects paths beyond it',async()=>{
 const child=origin+'/media/resource/opaque-token/index.m3u8',requests=[];let sequence=10;
 assert.equal(await checkPlaylist(url,{origin,sleep:async()=>{},fetcher:async address=>{requests.push(address);return {ok:true,text:async()=>address===url?`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\n${child}\n`:manifest(sequence++)};}}),'ready');
 assert.deepEqual(requests,[url,child,child]);
 for(const bad of [origin+'/media/resource/opaque-token/a/b.m3u8',origin+'/media/resource/opaque-token/..',origin+'/media/resource/opaque-token/index.m3u8?x=1',origin+'/media/resource/opaque-token/'+'x'.repeat(256)]){
  let count=0;assert.equal(await checkPlaylist(url,{origin,fetcher:async()=>{count++;return {ok:true,text:async()=>`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\n${bad}\n`};}}),'unavailable');assert.equal(count,1);
 }
});
