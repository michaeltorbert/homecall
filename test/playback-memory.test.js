import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackMemory } from '../src/playback-memory.js';
const storage=()=>{const records=new Map();return{getItem:k=>records.get(k),setItem:(k,v)=>records.set(k,v)};};
test('reload preserves live offset without adding elapsed wall time; recordings remain independent',()=>{
 const disk=storage();let now=1000;const first=new PlaybackMemory(disk,undefined,()=>now);
 first.save('live','duke',35);first.save('replay','duke:one',120);first.save('live','miami',12);
 now+=20000;const reloaded=new PlaybackMemory(disk,undefined,()=>now);
 assert.deepEqual(reloaded.read('live','duke'),{version:1,value:35,savedAt:1000});
 assert.equal(reloaded.read('live','miami').value,12);assert.equal(reloaded.read('replay','duke:one').value,120);
 assert.equal(reloaded.read('replay','duke:two'),null);
});
test('invalid records are ignored; storage failures do not interrupt playback',()=>{
 const disk=storage(),m=new PlaybackMemory(disk,undefined,()=>100);
 for(const record of ['bad',JSON.stringify({version:1,value:181,savedAt:0}),JSON.stringify({version:2,value:2,savedAt:101})]){
 disk.setItem('homecall.position.live.duke',record);assert.equal(m.read('live','duke'),null);
 }
 let warnings=0;const blocked=new PlaybackMemory({getItem(){throw Error();},setItem(){throw Error();}},()=>warnings++);
 assert.equal(blocked.read('live','duke'),null);blocked.save('live','duke',35);assert.equal(warnings,1);assert.equal(blocked.read('live','duke').value,35);
});

test('moving the device clock backward does not discard a valid delay',()=>{
 const disk=storage();const m=new PlaybackMemory(disk,undefined,()=>1000);m.save('live','duke',35);
 assert.equal(new PlaybackMemory(disk,undefined,()=>500).read('live','duke').value,35);
});
