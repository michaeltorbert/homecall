import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

// Controller unit harness, not a browser/media integration test. External
// devices and workers are replaced with controllable asynchronous boundaries.
function harness() {
  const elements=new Map(), attempts=[], indexers=[], messages=[];
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{textContent:'',value:'0.25',hidden:false,disabled:false,
      options:[],classList:{toggle(){}},replaceChildren(){},append(){}});
    return elements.get(id);
  };
  class Indexer {
    constructor(onState){this.onState=onState;this.tracker={reset(){}};indexers.push(this);}
    async start(){}
    stop(){this.stopped=true;}
  }
  const sandbox=vm.createContext({
    document:{getElementById:element}, window:{addEventListener(){}},
    fetch:async()=>({ok:false,json:async()=>({error:'Fixture: no schedule'})}),
    RadioIndexer:Indexer,startScoreboardCamera:(video,onRead,onStatus,sport,signal)=>
      new Promise((resolve,reject)=>attempts.push({resolve,reject,onRead,onStatus,signal})),
    AbortController,crypto:webcrypto,performance,clearInterval,URL,
    testNode:{port:{postMessage:data=>messages.push(data)}},
  });
  const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .+;\n/gm,'');
  vm.runInContext(source,sandbox);
  vm.runInContext('node=testNode',sandbox);
  return {element,attempts,indexers,messages,run:code=>vm.runInContext(code,sandbox)};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('late failure and status from a canceled camera cannot disturb the next scan',async()=>{
  const h=harness();
  const first=h.element('auto-sync').onclick();await tick();
  const second=h.element('auto-sync').onclick();await tick();
  assert.equal(h.attempts[0].signal.aborted,true);
  const currentStatus=h.element('camera-status').textContent;
  h.attempts[0].onStatus('Stale camera failure');
  assert.equal(h.element('camera-status').textContent,currentStatus);
  h.attempts[0].reject(new Error('Old permission request'));await first;
  assert.equal(h.indexers[1].stopped,undefined);
  assert.equal(h.attempts[1].signal.aborted,false);
  h.attempts[1].resolve(async()=>{});await second;
  h.run('stopAnalysis()');
});

test('successful automatic seek releases both recognition workers and camera',async()=>{
  const h=harness();
  const scan=h.element('auto-sync').onclick();await tick();
  h.attempts[0].resolve(async()=>{});await scan;
  h.run("pendingSync={requestId:'r',generation:syncGeneration,estimate:{disagreementSeconds:.5}}; handleAutomaticSeek({requestId:'r',state:'applied',delay:20})");
  assert.equal(h.indexers[0].stopped,true);
  assert.equal(h.attempts[0].signal.aborted,true);
  assert.equal(h.messages.at(-1).type,'analysis');assert.equal(h.messages.at(-1).value,false);
  assert.equal(h.element('stop-sync').hidden,true);
  assert.match(h.element('radio-status').textContent,/Automatically aligned/);
});

test('manual timing cancels matching and ignores an outstanding seek acknowledgement',async()=>{
  const h=harness();
  const scan=h.element('auto-sync').onclick();await tick();
  h.attempts[0].resolve(async()=>{});await scan;
  h.run("available=40;delay=10;pendingSync={requestId:'old',generation:syncGeneration,estimate:{}};");
  h.element('later').onclick();
  h.run("handleAutomaticSeek({requestId:'old',state:'applied',delay:30})");
  assert.equal(h.run('delay'),10.25);
  assert.equal(h.indexers[0].stopped,true);
  assert.doesNotMatch(h.element('radio-status').textContent,/Automatically aligned/);
});
