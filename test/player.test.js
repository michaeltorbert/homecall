import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function deferred() { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject}; }
function harness() {
  const contexts=[],audios=[],nodes=[],events=[],states=[];
  class Context {
    constructor(){this.state='running';this.module=deferred();this.audioWorklet={addModule:()=>this.module.promise};contexts.push(this);}
    resume(){this.state='running';return Promise.resolve();}
    close(){this.closed=true;return Promise.resolve();}
    createMediaElementSource(){return {connect(){}};}
    createGain(){return {gain:{value:0},connect(){}};}
  }
  class Audio {
    constructor(){this.played=deferred();this.readyState=4;audios.push(this);}
    play(){return this.played.promise;}
    pause(){this.paused=true;}
    removeAttribute(){} load(){}
  }
  class Node {
    constructor(){this.messages=[];this.port={postMessage:data=>this.messages.push(data)};nodes.push(this);}
    connect(){}
    ack(index=0){const m=this.messages[index];this.port.onmessage({data:{type:'ack',...m,action:m.type,type:'ack',result:'applied',after:{delay:0,paused:false},contextSeconds:1}});}
  }
  const sandbox=vm.createContext({window:{AudioContext:Context,AudioWorkletNode:Node,isSecureContext:true},Audio,AudioWorkletNode:Node,workletURL:'fixture',setTimeout,clearTimeout});
  const source=fs.readFileSync(new URL('../src/player.js',import.meta.url),'utf8').replace(/^import .*;\n/,'').replace('export class Player','class Player');
  vm.runInContext(source+'\nglobalThis.Player = Player;',sandbox);
  const player=new sandbox.Player(s=>states.push(s),e=>events.push(e));
  return{player,contexts,audios,nodes,events,states};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function connect(h){const started=h.player.start('https://fixture/stream');const a=h.audios.at(-1);a.onplaying();a.played.resolve();h.contexts.at(-1).module.resolve();await tick();h.nodes.at(-1).ack();await started;}
test('old source setup and callbacks cannot take over a newer connection',async()=>{
 const h=harness();const first=h.player.start('https://fixture/old');const oldPlaying=h.audios[0].onplaying;
 const second=h.player.start('https://fixture/new');oldPlaying();assert.equal(h.events.length,0);
 h.audios[0].played.resolve();h.contexts[0].module.resolve();await first;assert.equal(h.nodes.length,0);
 h.audios[1].onplaying();h.audios[1].played.resolve();h.contexts[1].module.resolve();await tick();h.nodes[0].ack();await second;
 assert.equal(h.contexts[0].closed,true);h.player.stop();
});
test('stop rejects pending commands; late old acknowledgments cannot update state',async()=>{
 const h=harness();await connect(h);const handler=h.nodes[0].port.onmessage;
 const command=h.player.command('nudge',.25);const rejection=assert.rejects(command,/disconnected/);h.player.stop();await rejection;
 handler({data:{type:'state',delay:99}});assert.equal(h.player.state,null);
});
test('network stall with buffered media does not stop ingestion; waiting does',async()=>{
 const h=harness();await connect(h);const node=h.nodes[0],count=node.messages.length;
 h.audios[0].onstalled();assert.equal(node.messages.length,count);
 h.audios[0].onwaiting();assert.equal(node.messages.at(-1).type,'interrupt');node.ack(node.messages.length-1);
 assert.equal(h.events.at(-1),'source-waiting');h.player.stop();
});
test('every command carries a distinct id and epoch and only its matching ack settles it',async()=>{
 const h=harness();await connect(h);const n=h.nodes[0];
 const first=h.player.command('nudge',.25), second=h.player.command('nudge',.25);
 assert.notEqual(n.messages[1].id,n.messages[2].id);assert.equal(n.messages[1].epoch,h.player.epoch);
 n.port.onmessage({data:{type:'ack',id:n.messages[1].id,epoch:-1,after:{delay:999}}});assert.equal(h.player.pending.size,2);
 n.ack(1);n.ack(2);await Promise.all([first,second]);assert.equal(h.player.pending.size,0);h.player.stop();
});
