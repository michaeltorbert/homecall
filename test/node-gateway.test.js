import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
test('Node HTTP keeps full target validation and rejects TRACE/POST without crashing',async t=>{
  const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{child.kill('SIGTERM');await once(child,'exit');});
  const url=await new Promise((resolve,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});child.on('error',reject);child.on('exit',code=>reject(Error('Server exited '+code)));});
  const request=(path,method='GET')=>new Promise((resolve,reject)=>{const req=http.request(url+path,{method},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});req.on('error',reject);req.end(method==='POST'?'ignored body':undefined);});
  assert.equal(await request('/api/sync/teams','TRACE'),405);
  assert.equal(await request('/api/sync/teams','POST'),405);
  assert.equal(await request('/api/sync/teams?host=evil'),404);
  assert.equal(await request('/api/sync/%74eams'),404);
  assert.equal(await request('/api/sync/plays/1?event=2'),404);
  assert.equal(await request('/api/sync/missing'),404);
});
