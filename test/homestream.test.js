import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTeams, normalizeGames, checkPlaylist, mediaURL } from '../src/homestream.js';
import { homestreamCatalog } from '../lib/homestream-catalog.mjs';
const team='410422f0-663f-4e3d-82e2-787d954ae29d',url='https://example.cloudfront.net/exact/stream.m3u8';
const game={game_id:'one',game_type:'football',home_team_id:team,away_team_id:'other',home_cloudfront_url:url,away_cloudfront_url:'https://wrong.cloudfront.net/stream.m3u8',date:'2026-09-12',time:'23:00',timezone:'UTC',away_team_school_name:'Tennessee'};
const manifest=(seq=10,ended=false)=>`#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:${seq}\n#EXTINF:1,\nsegment_${seq}.ts\n${ended?'#EXT-X-ENDLIST':''}`;
test('catalog resolves exact team and side; absent feeds stay unpublished and unrelated sports are excluded',()=>{
 assert.deepEqual(normalizeTeams({success:true,teams:[{team_id:team,school_name:' Georgia Tech '}]}),[{id:team,name:'Georgia Tech'}]);
 const games=normalizeGames({success:true,games:[game,{...game,game_id:'away',home_team_id:'other',away_team_id:team},{...game,game_id:'missing',home_cloudfront_url:null},{...game,game_type:'basketball'},{...game,home_team_id:'other'}]},team);
 assert.equal(games.length,3);assert.equal(games[0].url,url);assert.equal(games[1].url,game.away_cloudfront_url);assert.equal(games[2].url,null);
 assert.equal(games[0].start,Date.parse('2026-09-12T23:00:00Z'));assert.equal(games[0].opponent,'Tennessee');
});
test('invalid catalogs and unsafe media addresses are rejected',()=>{
 assert.throws(()=>normalizeTeams({success:false,teams:[]}));assert.throws(()=>normalizeGames({},team));
 for(const value of ['http://example.cloudfront.net/a.m3u8','https://example.cloudfront.net.evil.com/a.m3u8','https://user:secret@example.cloudfront.net/a.m3u8','https://localhost/a.m3u8'])assert.equal(mediaURL(value),null);
});
test('availability checks distinguish advancing, frozen, ended, missing and invalid media',async()=>{
 async function probe(items){return checkPlaylist(url,{sleep:async()=>{},fetcher:async()=>{const x=items.shift();return typeof x==='number'?{ok:false,status:x}:{ok:true,text:async()=>x};}})}
 assert.equal(await probe([manifest(10),manifest(13)]),'ready');
 assert.equal(await probe([manifest(10),manifest(10)]),'stalled');
 assert.equal(await probe([manifest(10,true)]),'ended');
 assert.equal(await probe([404]),'missing');assert.equal(await probe([403]),'unavailable');
 assert.equal(await probe(['<html>error</html>']),'unavailable');
 assert.equal(await checkPlaylist(null),'unpublished');
});
test('canceling a playlist check cannot yield a ready obsolete source',async()=>{
 const c=new AbortController();
 await assert.rejects(checkPlaylist(url,{signal:c.signal,fetcher:async()=>({ok:true,text:async()=>manifest()}),sleep:async()=>{c.abort();throw c.signal.reason;}}),{name:'AbortError'});
});
test('gateway permits only fixed anonymous catalog routes and returns minimized data',async()=>{
 const requests=[];const fetcher=async(u,o)=>{requests.push({u,o});return{ok:true,json:async()=>({success:true,games:[{...game,secret:'excluded'}]})};};
 const data=await homestreamCatalog('/api/homestream/games/'+team,{fetcher});assert.equal(data[0].url,url);assert.equal(data[0].secret,undefined);
 assert.equal(requests[0].o.credentials,'omit');assert.ok(requests[0].u.endsWith('?game_type=football'));
 assert.equal(await homestreamCatalog('/api/homestream/games/https://evil.test',{fetcher}),null);
 assert.equal(await homestreamCatalog('/api/homestream/games/'+team+'?url=evil',{fetcher}),null);assert.equal(requests.length,1);
});
