import test from 'node:test';
import assert from 'node:assert/strict';
import {privateGames} from '../lib/homestream-catalog.mjs';
const team='410422f0-663f-4e3d-82e2-787d954ae29d';
const catalog={version:'v1',discovery:{homestreamBase:'https://catalog.example',mediaOrigins:['https://audio.example']}};
const data=url=>({success:true,games:[{game_id:'a',game_type:'football',home_team_id:team,home_cloudfront_url:url,date:'2026-09-01',time:'12:00',timezone:'UTC'}]});
test('private discovery reuses only fresh unsigned results and fails after expiry',async()=>{
 let calls=0,time=0,fail=false;const fetcher=async()=>{calls++;if(fail)throw Error('offline');return Response.json(data('https://audio.example/a.m3u8'));};const options={catalog,fetcher,now:()=>time};
 await privateGames(team,options);time=14000;await privateGames(team,options);assert.equal(calls,1);time=15000;fail=true;await assert.rejects(privateGames(team,options));assert.equal(calls,2);
});
test('signed discovery URLs are not cached beyond provider expiration',async()=>{let calls=0;const fetcher=async()=>{calls++;return Response.json(data('https://audio.example/a.m3u8?Expires=1'));};await privateGames(team,{catalog,fetcher});await privateGames(team,{catalog,fetcher});assert.equal(calls,2);});
