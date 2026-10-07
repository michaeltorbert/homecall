import test from 'node:test';
import assert from 'node:assert/strict';
import {readPrivateCatalog,publicArchiveCatalog,publicLiveCatalog,findArchiveTarget,refreshPrivateCatalog} from '../lib/private-catalog.mjs';
const stamp='2026-09-01T00:00:00.000Z';
const seed=()=>({schemaVersion:1,version:'1',updatedAt:stamp,live:{duke:{url:'https://audio.example/live',allowedOrigins:['https://audio.example'],kind:'audio'}},archive:{checkedAt:stamp,schools:{duke:{source:'https://school.example/',status:'ready',checkedAt:stamp,items:[{id:'a',opponent:'Visitor',sport:'Football',start:stamp,url:'https://audio.example/replay/123.mp3',kind:'Game recording'}]},vt:{source:'https://school.example/vt',status:'unavailable',items:[]}}},archiveConfig:{dukePlayer:'https://player.example/',dukeFeedPath:'/previous.xml',vtFeed:'https://feed.example/vt',replayRules:{duke:[{origin:'https://audio.example',pathPrefix:'/replay/',filenamePattern:'^\\d+\\.mp3$'}],vt:[]}}});
function storage(value){let current=JSON.stringify(value);const writes=[];return {env:{STREAM_CATALOG:{get:async()=>current,put:async(k,v)=>{writes.push([k,v]);current=v;}}},writes,get:()=>JSON.parse(current)};}
test('public projection exposes gateway addresses and no private fields',async()=>{const {env}=storage(seed());const c=await readPrivateCatalog(env);const output=JSON.stringify([publicArchiveCatalog(c,'https://gateway.example'),publicLiveCatalog(c,'https://gateway.example')]);assert.ok(!output.includes('audio.example'));assert.ok(!output.includes('archiveConfig'));assert.match(output,/media\/archive\/duke\/a/);assert.equal(findArchiveTarget(c,'duke','a').url,c.archive.schools.duke.items[0].url);assert.equal(findArchiveTarget(c,'duke','missing'),null);});
test('failed refresh preserves recordings and their last successful timestamp',async()=>{const s=storage(seed());await refreshPrivateCatalog(s.env,{fetcher:async()=>{throw Error('private URL must not leak');},now:Date.parse(stamp)+10000});assert.equal(s.get().archive.schools.duke.status,'stale');assert.equal(s.get().archive.schools.duke.checkedAt,stamp);assert.equal(s.get().archive.schools.duke.items.length,1);assert.equal(s.writes.length,1);await refreshPrivateCatalog(s.env,{fetcher:async()=>{throw Error('offline');},now:Date.parse(stamp)+20000});assert.equal(s.writes.length,1);});
test('successful empty feeds replace prior records, with one whole-document write',async()=>{const s=storage(seed());const fetcher=async url=>new Response(url==='https://player.example/'?'previous: "https://player.example/previous.xml"':url.endsWith('.xml')?'<main><previous_ev></previous_ev></main>':JSON.stringify({data:{sports:{sport:[]},events:{previous_ev:{event:[]}}}}));await refreshPrivateCatalog(s.env,{fetcher,now:Date.parse(stamp)+10000});assert.deepEqual(s.get().archive.schools.duke.items,[]);assert.equal(s.get().archive.schools.vt.status,'ready');assert.equal(s.writes.length,1);});
test('malformed catalog fails without leaking content or allowing reads to write',async()=>{const c=seed();c.live.duke.allowedOrigins=['https://foreign.example'];const s=storage(c);await assert.rejects(readPrivateCatalog(s.env),/^Error: Private catalog invalid$/);assert.equal(s.writes.length,0);});
test('unknown school including prototype properties has no target',()=>{assert.equal(findArchiveTarget(seed(),'__proto__','a'),null);});
test('oversized KV data rejected before JSON parsing',async()=>{await assert.rejects(readPrivateCatalog({STREAM_CATALOG:{get:async()=> 'x'.repeat(5_000_001)}}),/unavailable/);});
test('refresh keeps policy version and accepts explicitly allowed custom ports',async()=>{const c=seed();c.live.duke={url:'https://audio.example:8443/live',allowedOrigins:['https://audio.example:8443'],kind:'audio'};const s=storage(c);await readPrivateCatalog(s.env);await refreshPrivateCatalog(s.env,{fetcher:async()=>{throw Error('offline');},now:Date.parse(stamp)+10000});assert.equal(s.get().version,'1');});
test('malformed Duke document preserves last-known-good archive',async()=>{const s=storage(seed());await refreshPrivateCatalog(s.env,{fetcher:async url=>new Response(url==='https://player.example/'?'previous: "https://player.example/previous.xml"':'<main>unrecognized</main>'),now:Date.parse(stamp)+10000});assert.equal(s.get().archive.schools.duke.items.length,1);assert.equal(s.get().archive.schools.duke.checkedAt,stamp);});
test('private source field cannot accidentally publish a discovery URL',()=>{const c=seed();c.archive.schools.duke.source='https://private.example/discovery?token=secret';const body=JSON.stringify(publicArchiveCatalog(c,'https://gateway.example'));assert.ok(!body.includes('private.example'));assert.ok(body.includes('goduke.com'));});
test('archive redirect origins must be exact approved HTTPS origins for known schools',async()=>{const ok=seed();ok.archiveConfig.redirectOrigins={vt:['https://store.example'],duke:[]};const t=findArchiveTarget(await readPrivateCatalog(storage(ok).env),'duke','a');assert.deepEqual(t.allowedOrigins,['https://audio.example']);ok.archiveConfig.redirectOrigins.duke=['https://store.example','https://audio.example'];assert.deepEqual(findArchiveTarget(await readPrivateCatalog(storage(ok).env),'duke','a').allowedOrigins,['https://audio.example','https://store.example']);for(const bad of [['https://store.example/path'],['http://store.example'],'https://store.example',Array.from({length:17},(_,i)=>`https://s${i}.example`)]){const c=seed();c.archiveConfig.redirectOrigins={vt:bad};await assert.rejects(readPrivateCatalog(storage(c).env),/^Error: Private catalog invalid$/);}const unknown=seed();unknown.archiveConfig.redirectOrigins={other:['https://store.example']};await assert.rejects(readPrivateCatalog(storage(unknown).env),/^Error: Private catalog invalid$/);const inherited=seed();inherited.archiveConfig.redirectOrigins={__proto__:{duke:['https://store.example']}};assert.deepEqual(findArchiveTarget(await readPrivateCatalog(storage(inherited).env),'duke','a').allowedOrigins,['https://audio.example']);const own=JSON.stringify(seed()).replace('"replayRules"','"redirectOrigins":{"__proto__":{"duke":["https://store.example"]}},"replayRules"');await assert.rejects(readPrivateCatalog({STREAM_CATALOG:{get:async()=>own}}),/^Error: Private catalog invalid$/);});
// Issue #4: per-school last-known-good retention. Synthetic feeds; no real source or catalog.
const T1=Date.parse('2026-09-10T00:00:00Z'),T2=T1+6*3600_000,T3=T2+6*3600_000,iso=t=>new Date(t).toISOString();
const vtItem={id:'v0',opponent:'Visitor',sport:'Football',start:stamp,url:'https://audio.example/vt/0.mp3',kind:'Game recording'};
const seed2=(edit=()=>{})=>{const c=seed();c.archiveConfig.replayRules.vt=[{origin:'https://audio.example',pathPrefix:'/vt/',filenamePattern:'^\\d+\\.mp3$'}];c.archive.schools.vt={source:'https://school.example/vt',status:'ready',checkedAt:stamp,items:[vtItem]};edit(c);return c;};
const dukeRow=(n,{opponent='Visitor',archive=`https://audio.example/replay/${n}.mp3`}={})=>`<event><id>d${n}</id><start_timestamp>${1788645600+n}</start_timestamp><end>2026-09-06 21:00:00</end><sport_id>1</sport_id><opponent>${opponent}</opponent><archive_url>${archive}</archive_url></event>`;
const dukeFeed=(...rows)=>`<main><events><previous_ev>${rows.join('')}</previous_ev></events></main>`;
const vtEvent=(n,over={})=>({id:`v${n}`,opponent:'Visitor',start_timestamp:String(1788645600+n),sport_id:'1',archive_url:`https://audio.example/vt/${n}.mp3`,...over});
const vtFeed=(...event)=>JSON.stringify({data:{sports:{sport:[{id:'1',name:'Football',is_show:'0'}]},events:{previous_ev:{event}}}});
// `undefined` means that school's source is offline; the thrown text deliberately contains a private-looking address.
function upstream({duke,vt}={}){const calls=[];const fetcher=async url=>{calls.push(url);
 if(url==='https://player.example/'){if(duke===undefined)throw Error('offline https://player.example/?token=secret');return new Response('previous: "https://player.example/previous.xml"');}
 if(url==='https://player.example/previous.xml')return new Response(duke);
 if(url==='https://feed.example/vt'){if(vt===undefined)throw Error('offline https://feed.example/vt?token=secret');return new Response(vt);}
 throw Error('unexpected fixture request');};return Object.assign(fetcher,{calls});}
const ids=school=>school.items.map(i=>i.id);
const concealed=c=>{const body=JSON.stringify(publicArchiveCatalog(c,'https://gateway.example'));assert.ok(!body.includes('audio.example')&&!body.includes('player.example')&&!body.includes('feed.example'));return body;};
test('one school failing keeps its validated list and original time while the other school refreshes, then recovers',async()=>{
 const s=storage(seed2());
 await refreshPrivateCatalog(s.env,{fetcher:upstream({vt:vtFeed(vtEvent(1))}),now:T1});
 let c=s.get();assert.deepEqual([c.archive.schools.duke.status,c.archive.schools.duke.checkedAt,ids(c.archive.schools.duke)],['stale',stamp,['a']]);
 assert.deepEqual([c.archive.schools.vt.status,c.archive.schools.vt.checkedAt,ids(c.archive.schools.vt)],['ready',iso(T1),['v1']]);
 assert.equal(c.archive.checkedAt,iso(T1));assert.equal(s.writes.length,1);
 await refreshPrivateCatalog(s.env,{fetcher:upstream({duke:dukeFeed(dukeRow(1)),vt:vtFeed(vtEvent(1))}),now:T2});
 c=s.get();assert.deepEqual([c.archive.schools.duke.status,c.archive.schools.duke.checkedAt,ids(c.archive.schools.duke)],['ready',iso(T2),['d1']]);
 await refreshPrivateCatalog(s.env,{fetcher:upstream({duke:dukeFeed(dukeRow(1))}),now:T3});
 c=s.get();assert.deepEqual([c.archive.schools.vt.status,c.archive.schools.vt.checkedAt,ids(c.archive.schools.vt)],['stale',iso(T2),['v1']]);
 assert.equal(c.archive.schools.duke.checkedAt,iso(T3));
 const body=concealed(await readPrivateCatalog(s.env));assert.match(body,/media\/archive\/vt\/v1/);
});
test('successful empty history is retained as stale on failure; unavailable without history stays unavailable',async()=>{
 const s=storage(seed2(c=>{c.archive.schools.duke.items=[];c.archive.schools.vt={source:'https://school.example/vt',status:'unavailable',items:[]};}));
 await refreshPrivateCatalog(s.env,{fetcher:upstream(),now:T1});
 const c=s.get();assert.deepEqual([c.archive.schools.duke.status,c.archive.schools.duke.checkedAt,c.archive.schools.duke.items],['stale',stamp,[]]);
 assert.equal(c.archive.schools.vt.status,'unavailable');assert.equal(c.archive.schools.vt.checkedAt,undefined);
 assert.equal(c.archive.checkedAt,stamp,'no school was checked, so the catalog check time does not move');
 const projected=publicArchiveCatalog(await readPrivateCatalog(s.env),'https://gateway.example');assert.equal(projected.schools.duke.status,'stale');assert.equal(projected.schools.duke.checkedAt,stamp);
});
test('legacy ready inherits only a valid non-future old catalog time; legacy stale without a time stays unknown',async()=>{
 const legacy=storage(seed2(c=>{delete c.archive.schools.duke.checkedAt;}));
 await refreshPrivateCatalog(legacy.env,{fetcher:upstream({vt:vtFeed(vtEvent(1))}),now:T1});
 assert.deepEqual([legacy.get().archive.schools.duke.status,legacy.get().archive.schools.duke.checkedAt],['stale',stamp]);
 const future=storage(seed2(c=>{delete c.archive.schools.duke.checkedAt;c.archive.checkedAt=iso(T1+3600_000);}));
 await refreshPrivateCatalog(future.env,{fetcher:upstream(),now:T1});
 assert.equal(future.get().archive.schools.duke.status,'stale');assert.equal(Object.hasOwn(future.get().archive.schools.duke,'checkedAt'),false);
 const stale=storage(seed2(c=>{c.archive.schools.duke.status='stale';delete c.archive.schools.duke.checkedAt;c.archive.schools.vt.status='stale';}));
 await refreshPrivateCatalog(stale.env,{fetcher:upstream(),now:T1});assert.equal(stale.writes.length,0,'repeated failure changes nothing');
 await refreshPrivateCatalog(stale.env,{fetcher:upstream({vt:vtFeed(vtEvent(1))}),now:T2});
 assert.equal(Object.hasOwn(stale.get().archive.schools.duke,'checkedAt'),false,'a later catalog write never stamps a stale school');
 assert.equal(stale.get().archive.checkedAt,iso(T2));
});
test('invalid or missing retained KV fails closed before any source request or write',async()=>{
 for(const bad of [seed2(c=>{c.archive.schools.duke.items[0].url='https://audio.example/other/1.mp3';}),seed2(c=>{c.archive.schools.vt.items.push({...vtItem});}),seed2(c=>{c.archive.schools.duke.checkedAt='yesterday';})]){
  const s=storage(bad),fetcher=upstream({duke:dukeFeed(dukeRow(1)),vt:vtFeed(vtEvent(1))});
  await assert.rejects(refreshPrivateCatalog(s.env,{fetcher,now:T1}),/^Error: Private catalog invalid$/);assert.equal(fetcher.calls.length,0);assert.equal(s.writes.length,0);
 }
 const writes=[],fetcher=upstream();
 await assert.rejects(refreshPrivateCatalog({STREAM_CATALOG:{get:async()=>null,put:async(...a)=>writes.push(a)}},{fetcher,now:T1}),/^Error: Private catalog unavailable$/);
 await assert.rejects(refreshPrivateCatalog({},{fetcher,now:T1}),/^Error: Private catalog unavailable$/);
 assert.equal(fetcher.calls.length,0);assert.equal(writes.length,0);
});
test('strict refresh: a policy-rejected, malformed or conflicting eligible row retains that school only, with redacted counts',async()=>{
 for(const [duke,key] of [[dukeFeed(dukeRow(1),dukeRow(2,{archive:'https://foreign.example/replay/2.mp3'})),'policyRejected'],[dukeFeed(dukeRow(2,{archive:'https://audio.example/replay/x.mp3'})),'policyRejected'],
  [dukeFeed(dukeRow(1),dukeRow(1,{opponent:'Other'})),'duplicateConflict'],[dukeFeed(dukeRow(1).replace('<sport_id>1</sport_id>','')),'malformed'],[dukeFeed('<event id="2"></event>'),'structural']]){
  const s=storage(seed2()),stats={};
  await refreshPrivateCatalog(s.env,{fetcher:upstream({duke,vt:vtFeed(vtEvent(1))}),now:T1,stats});
  const c=s.get();assert.deepEqual([c.archive.schools.duke.status,c.archive.schools.duke.checkedAt,ids(c.archive.schools.duke)],['stale',stamp,['a']],key);
  assert.deepEqual([c.archive.schools.vt.status,c.archive.schools.vt.checkedAt],['ready',iso(T1)]);
  assert.equal(stats.duke.outcome,'retained');assert.equal(stats.duke.failure,'rows');assert.ok(stats.duke[key]>=1,key);assert.equal(stats.vt.outcome,'refreshed');assert.equal(stats.vt.accepted,1);
  const text=JSON.stringify(stats);assert.ok(!/example|secret|Visitor|Other|https/.test(text));
  for(const school of Object.values(stats))for(const [k,v] of Object.entries(school))assert.ok(Number.isInteger(v)||(k==='outcome'&&['refreshed','retained','unavailable'].includes(v))||(k==='failure'&&['rows','source','candidate'].includes(v)),k);
 }
 const ok=storage(seed2()),stats={};
 await refreshPrivateCatalog(ok.env,{fetcher:upstream({duke:dukeFeed(dukeRow(1),dukeRow(9,{archive:''})),vt:undefined}),now:T1,stats});
 assert.deepEqual(ids(ok.get().archive.schools.duke),['d1']);assert.equal(stats.duke.unrecorded,1);assert.deepEqual([stats.vt.outcome,stats.vt.failure],['retained','source']);
});
test('an unrecognized VT envelope keeps VT history and time while Duke commits; a recognized empty feed still replaces history',async()=>{
 const event=[vtEvent(1)];
 for(const events of [{},{renamed_previous:{event}},{previous_ev:{renamed_event:event}}]){
  const s=storage(seed2()),stats={};
  await refreshPrivateCatalog(s.env,{fetcher:upstream({duke:dukeFeed(dukeRow(1)),vt:JSON.stringify({data:{sports:{sport:[{id:'1',name:'Football',is_show:'0'}]},events}})}),now:T1,stats});
  const c=s.get();assert.deepEqual([c.archive.schools.vt.status,c.archive.schools.vt.checkedAt,ids(c.archive.schools.vt)],['stale',stamp,['v0']],JSON.stringify(events));
  assert.deepEqual([c.archive.schools.duke.status,c.archive.schools.duke.checkedAt,ids(c.archive.schools.duke)],['ready',iso(T1),['d1']]);
  assert.deepEqual([stats.vt.failure,stats.vt.structural],['rows',1]);
 }
 const s=storage(seed2());
 await refreshPrivateCatalog(s.env,{fetcher:upstream({vt:vtFeed()}),now:T1});
 assert.deepEqual([s.get().archive.schools.vt.status,s.get().archive.schools.vt.checkedAt,s.get().archive.schools.vt.items],['ready',iso(T1),[]]);
 await refreshPrivateCatalog(s.env,{fetcher:upstream(),now:T2});
 assert.deepEqual([s.get().archive.schools.vt.status,s.get().archive.schools.vt.checkedAt,s.get().archive.schools.vt.items],['stale',iso(T1),[]]);
});
test('a renamed Duke event element keeps the Duke list and original time while VT commits (REVIEW004)',async()=>{
 const renamed='<renamed_event><id>d2</id></renamed_event>';
 for(const duke of [dukeFeed(renamed),dukeFeed(dukeRow(1),renamed),`<main><events><previous_ev>${dukeRow(1)}</previous_ev><archived_ev>${renamed}</archived_ev></events></main>`]){
  const s=storage(seed2()),stats={};
  await refreshPrivateCatalog(s.env,{fetcher:upstream({duke,vt:vtFeed(vtEvent(1))}),now:T1,stats});
  const c=s.get();
  assert.deepEqual([c.archive.schools.duke.status,c.archive.schools.duke.checkedAt,ids(c.archive.schools.duke)],['stale',stamp,['a']],duke);
  assert.deepEqual([c.archive.schools.vt.status,c.archive.schools.vt.checkedAt,ids(c.archive.schools.vt)],['ready',iso(T1),['v1']]);
  assert.deepEqual([stats.duke.outcome,stats.duke.failure,stats.duke.structural],['retained','rows',1]);
 }
});
test('strict refresh: an unreviewed filename-only row still retains the school, counted as policy-rejected',async()=>{
 const s=storage(seed2()),stats={};
 const renamed=vtEvent(2,{archive_url:'https://audio.example/vt/renamed.mp3',recorded_url:'https://audio.example/vt/other.mp3'});
 await refreshPrivateCatalog(s.env,{fetcher:upstream({duke:dukeFeed(dukeRow(1)),vt:vtFeed(vtEvent(1),renamed)}),now:T1,stats});
 assert.deepEqual([s.get().archive.schools.vt.status,s.get().archive.schools.vt.checkedAt,ids(s.get().archive.schools.vt)],['stale',stamp,['v0']]);
 assert.deepEqual([stats.vt.policyRejected,stats.vt.sourceExcluded,stats.vt.accepted],[1,0,1]);assert.equal(stats.duke.outcome,'refreshed');
});
test('fresh candidates are validated inside the per-school attempt: an over-limit list keeps history while the peer commits',async()=>{
 const s=storage(seed2()),stats={};
 const many=vtFeed(...Array.from({length:5001},(_,n)=>vtEvent(n+1)));
 await refreshPrivateCatalog(s.env,{fetcher:upstream({duke:dukeFeed(dukeRow(1)),vt:many}),now:T1,stats});
 const c=s.get();assert.deepEqual([c.archive.schools.vt.status,c.archive.schools.vt.checkedAt,ids(c.archive.schools.vt)],['stale',stamp,['v0']]);
 assert.deepEqual([c.archive.schools.duke.status,ids(c.archive.schools.duke)],['ready',['d1']]);
 assert.deepEqual([stats.vt.failure,stats.vt.accepted],['candidate',5001]);
});
// Overlap is not excluded (single configured schedule; no lock/CAS). These interleavings assert what
// does hold — a whole valid document, timestamps bound to their own evidence, concealed public
// output — and name what does not: lost updates and check-time regression.
const gate=fetcher=>{let open;const wait=new Promise(r=>{open=r;});return {open,fetcher:async(...a)=>{await wait;return fetcher(...a);}};};
const tick=()=>new Promise(r=>setImmediate(r));
async function overlapped(s,first,second){const p1=refreshPrivateCatalog(s.env,{fetcher:first.gate.fetcher,now:first.now}),p2=refreshPrivateCatalog(s.env,{fetcher:second.gate.fetcher,now:second.now});await tick();first.gate.open();await p1;second.gate.open();await p2;}
async function assertIntegrity(s,evidence){
 const c=await readPrivateCatalog(s.env);concealed(c);
 for(const [school,data] of Object.entries(c.archive.schools)){
  const bound=evidence.filter(e=>e.school===school&&e.checkedAt===data.checkedAt);
  assert.ok(bound.some(e=>JSON.stringify(e.ids)===JSON.stringify(ids(data))),`${school} time ${data.checkedAt} is bound to the list it was stamped with`);
 }
 return c;
}
test('characterization (lost update): overlapping refreshes are last-writer-wins and can drop a fresh school result',async()=>{
 const s=storage(seed2());
 await overlapped(s,{now:T1,gate:gate(upstream({duke:dukeFeed(dukeRow(1))}))},{now:T2,gate:gate(upstream({vt:vtFeed(vtEvent(2))}))});
 assert.equal(s.writes.length,2);
 const c=await assertIntegrity(s,[{school:'duke',checkedAt:stamp,ids:['a']},{school:'duke',checkedAt:iso(T1),ids:['d1']},{school:'vt',checkedAt:stamp,ids:['v0']},{school:'vt',checkedAt:iso(T2),ids:['v2']}]);
 assert.deepEqual([c.archive.schools.duke.status,c.archive.schools.duke.checkedAt,ids(c.archive.schools.duke)],['stale',stamp,['a']],'LOST UPDATE: the first run’s fresh Duke list was overwritten by a run that read the older document');
 assert.deepEqual([c.archive.schools.vt.status,c.archive.schools.vt.checkedAt,ids(c.archive.schools.vt)],['ready',iso(T2),['v2']]);
});
test('characterization (regression): an older-started overlapping run that writes last regresses a school check time',async()=>{
 const s=storage(seed2());
 await overlapped(s,{now:T2,gate:gate(upstream({duke:dukeFeed(dukeRow(2))}))},{now:T1,gate:gate(upstream({duke:dukeFeed(dukeRow(1))}))});
 const c=await assertIntegrity(s,[{school:'duke',checkedAt:iso(T1),ids:['d1']},{school:'duke',checkedAt:iso(T2),ids:['d2']},{school:'vt',checkedAt:stamp,ids:['v0']}]);
 assert.deepEqual([c.archive.schools.duke.checkedAt,ids(c.archive.schools.duke)],[iso(T1),['d1']],'REGRESSION: the newer T2 result is replaced by the older T1 result');
 assert.equal(c.archive.schools.vt.status,'stale');
});
test('non-overlapping runs keep both updates; each run reads the document the previous one wrote',async()=>{
 const s=storage(seed2());
 await refreshPrivateCatalog(s.env,{fetcher:upstream({duke:dukeFeed(dukeRow(1))}),now:T1});
 await refreshPrivateCatalog(s.env,{fetcher:upstream({vt:vtFeed(vtEvent(2))}),now:T2});
 const c=await assertIntegrity(s,[{school:'duke',checkedAt:iso(T1),ids:['d1']},{school:'vt',checkedAt:iso(T2),ids:['v2']}]);
 assert.deepEqual([c.archive.schools.duke.status,c.archive.schools.vt.status],['stale','ready']);
});
test('identical KV documents reuse the validated catalog; any change or failure re-reads',async()=>{const s=storage(seed());let reads=0;const get=s.env.STREAM_CATALOG.get;s.env.STREAM_CATALOG.get=async k=>{reads++;return get(k);};const a=await readPrivateCatalog(s.env),b=await readPrivateCatalog(s.env);assert.equal(a,b);assert.equal(reads,2);const other=storage(seed());assert.notEqual(await readPrivateCatalog(other.env),a);await refreshPrivateCatalog(s.env,{fetcher:async()=>{throw Error('offline');},now:Date.parse(stamp)+10000});const c=await readPrivateCatalog(s.env);assert.notEqual(c,a);assert.equal(c.archive.schools.duke.status,'stale');assert.equal(await readPrivateCatalog(s.env),c);const broken=storage(seed());const good=await readPrivateCatalog(broken.env);broken.env.STREAM_CATALOG.get=async()=>'{"schemaVersion":1}';await assert.rejects(readPrivateCatalog(broken.env),/invalid/);broken.env.STREAM_CATALOG.get=async()=>JSON.stringify(seed());assert.equal(await readPrivateCatalog(broken.env),good);const changed=seed();changed.version='2';broken.env.STREAM_CATALOG.get=async()=>JSON.stringify(changed);assert.equal((await readPrivateCatalog(broken.env)).version,'2');});
