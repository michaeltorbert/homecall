// Local workerd only: fixture upstreams and an ephemeral HTTP listener. No account access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Miniflare, Response as FixtureResponse } from 'miniflare';
execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--env=', '--dry-run', '--outdir', 'output/worker-dry-run'], { stdio: 'inherit', env:{...process.env,WRANGLER_LOG_PATH:'output/wrangler-test.log',WRANGLER_SEND_METRICS:'false'} });
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const bundle = readFileSync('output/worker-dry-run/index.js', 'utf8');
const origin = 'https://michaeltorbert.github.io';
const catalog={schemaVersion:1,version:'test-v1',updatedAt:'2026-09-01T00:00:00Z',live:{fixture:{url:'https://audio.example/live',allowedOrigins:['https://audio.example'],kind:'audio'}},archive:{checkedAt:'2026-09-01T00:00:00Z',schools:{}},discovery:{homestreamBase:'https://discovery.example',mediaOrigins:['https://audio.example']}};
const uuid = '410422f0-663f-4e3d-82e2-787d954ae29d';
let calls = 0;
let streamClosed = false;
const streamingUpstream = (req,res) => {
  res.setHeader('Content-Type','audio/mpeg');
  const timer=setInterval(()=>res.write(Buffer.alloc(1024)),20);
  res.on('close',()=>{streamClosed=true;clearInterval(timer);});
};
const upstream = async request => {
  calls++;
  const url = new URL(request.url);
  assert.equal(request.headers.get('Authorization'), null);
  assert.equal(request.headers.get('Cookie'), null);
  if (url.hostname === 'audio.example') return new FixtureResponse(new Uint8Array([73,68,51,0,1,2]), {headers:{'Content-Type':'audio/mpeg','Location':'https://audio.example/private','Set-Cookie':'private=1'}});
  if (url.searchParams.get('event') === '2') return FixtureResponse.redirect('https://unexpected.invalid/redirect');
  if (url.hostname === 'unexpected.invalid') throw Error('A redirect must never be followed');
  if (url.searchParams.get('event') === '3') return new FixtureResponse('<html>invalid</html>', { headers: { 'Content-Type': 'text/html' } });
  if (url.searchParams.get('event') === '4') return new FixtureResponse(' '.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } });
  if (url.pathname.endsWith('/summary')) return FixtureResponse.json({header:{id:url.searchParams.get('event'),uid:`s:20~l:23~e:${url.searchParams.get('event')}`,league:{id:'23',slug:'college-football'},season:{year:2026},competitions:[{id:url.searchParams.get('event'),competitors:[{team:{id:'150'}},{team:{id:'356'}}]}]},drives:{previous:[],current:{plays:[]}}}, {headers:{Date:new Date().toUTCString(),Age:'2'}});
  // SYNTHETIC live game (issue #19 scoreboard contract), not a captured provider sample.
  if (url.pathname.endsWith('/schedule') && url.searchParams.get('season') === '2025') return FixtureResponse.json({team:{id:'150'},season:{year:2025},events:[{id:'401700001',date:'2025-10-11T19:30Z',season:{year:2025},competitions:[{id:'401700001',competitors:[
    {id:'59',homeAway:'home',score:{value:17,displayValue:'17'},team:{id:'59',location:'Georgia Tech',abbreviation:'GT',logos:[{href:'https://a.espncdn.com/i/teamlogos/ncaa/500/59.png'}]}},
    {id:'150',homeAway:'away',score:{value:14,displayValue:'14'},team:{id:'150',location:'Duke',abbreviation:'DUKE',logos:[{href:'https://a.espncdn.com/i/teamlogos/ncaa/500/150.png'}]}}],
    status:{clock:449,displayClock:'7:29',period:2,type:{id:'2',name:'STATUS_IN_PROGRESS',state:'in',completed:false,description:'In Progress',detail:'7:29 - 2nd Quarter',shortDetail:'7:29 - 2nd'}}}]}]}, {headers:{Date:new Date().toUTCString(),Age:'1'}});
  if (url.pathname.endsWith('/schedule')) return FixtureResponse.json({team:{id:'150'},season:{year:2026},events:[{id:'401858255',date:'2026-10-10T19:30Z',season:{year:2026},competitions:[{id:'401858255',competitors:[{id:'150',team:{id:'150',location:'Duke'}},{id:'2390',team:{id:'2390',location:'Tulane'}}],
    status:{clock:0,displayClock:'0:00',period:0,type:{id:'1',name:'STATUS_SCHEDULED',state:'pre',completed:false,description:'Scheduled',detail:'Sat, October 10th at 3:30 PM EDT',shortDetail:'10/10 - 3:30 PM EDT'}}}]}]}, {headers:{Date:new Date().toUTCString(),Age:'1'}});
  if (url.pathname.includes('/games/')) return FixtureResponse.json({success:true,games:[]});
  if (url.hostname.includes('espn.com')) return FixtureResponse.json({sports:[{leagues:[{teams:[]}]}]});
  return FixtureResponse.json({success:true,teams:[{team_id:uuid,school_name:'Georgia Tech'}]});
};
const readerProbe = `import { readBackendJSON } from './backend-json.mjs';
export default { async fetch() {
  let cancelled = false, options;
  const signal = new AbortController().signal;
  const fetcher = async (url, init) => { options = init; return new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; }
  }), { headers: { 'Content-Type': 'application/json' } }); };
  let timeout = false;
  try { await readBackendJSON('https://fixture.invalid', { fetcher, signal, timeoutMs: 20 }); }
  catch (error) { timeout = error.name === 'TimeoutError'; }
  return Response.json({ timeout, cancelled, cache: options.cache, credentials: options.credentials, redirect: options.redirect, combinedSignal: options.signal !== signal });
}};`;
const mf = new Miniflare({
  telemetry: { enabled: false },
  workers: [
    { config: { name: 'gateway', type: 'worker', compatibilityDate: config.compatibility_date,
      manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: bundle } } },
      env: { MEDIA_STREAM_MODE: {type:'text',value:'native'}, ALLOWED_ORIGINS: { type: 'text', value: config.vars.ALLOWED_ORIGINS }, STREAM_CATALOG: {type:'kv',id:'fixture-catalog'} }
    }, dev: { outboundService: { type: 'fetcher', handler: upstream } } },
    { config: { name: 'cancel-probe', type: 'worker', compatibilityDate: config.compatibility_date,
      manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: bundle } } },
      env: { MEDIA_STREAM_MODE: {type:'text',value:'native'}, ALLOWED_ORIGINS: { type: 'text', value: config.vars.ALLOWED_ORIGINS }, STREAM_CATALOG: {type:'kv',id:'fixture-catalog'} }
    }, dev: { outboundService: {type:'node-handler',handler:streamingUpstream} } },
    { config: { name: 'reader-probe', type: 'worker', compatibilityDate: config.compatibility_date,
      manifest: { mainModule: 'probe.mjs', modules: {
        'probe.mjs': { type: 'esm', contents: readerProbe },
        'backend-json.mjs': { type: 'esm', contents: readFileSync('lib/backend-json.mjs', 'utf8') }
      } }
    } }
  ]
});
try {
  const local = await mf.ready;
  const kv=await mf.getKVNamespace('STREAM_CATALOG','gateway');
  await kv.put('catalog',JSON.stringify(catalog));
  const request = (target, init) => fetch(new URL(target, local), init);
  for (const target of ['/api/homestream/teams', `/api/homestream/games/${uuid}`, '/api/sync/teams', '/api/sync/schedule/150/2026']) {
    const response = await request(target, { headers: { Origin: origin, Authorization: 'do-not-forward', Cookie: 'do-not-forward' } });
    assert.equal(response.status, 200, target);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.ok(Array.isArray(await response.json()));
  }
  const projected=await (await request('/api/catalog/live')).json();
  assert.equal(projected[0].id,'fixture');assert.equal(new URL(projected[0].url).pathname,'/media/live/fixture');
  assert.ok(!JSON.stringify(projected).includes('audio.example'));
  const media=await request('/media/live/fixture',{headers:{Origin:origin,Authorization:'private',Cookie:'private=1'}});
  assert.equal(media.status,200);assert.equal(media.headers.get('Content-Type'),'audio/mpeg');
  assert.equal(media.headers.get('Location'),null);assert.equal(media.headers.get('Set-Cookie'),null);
  assert.deepEqual([...new Uint8Array(await media.arrayBuffer())],[73,68,51,0,1,2]);
  const cancelWorker=await mf.getWorker('cancel-probe');
  const continuous=await cancelWorker.fetch('https://gateway.example/media/live/fixture');
  const continuousReader=continuous.body.getReader();
  assert.ok((await continuousReader.read()).value.length>0);
  await continuousReader.cancel();
  for(let i=0;i<100&&!streamClosed;i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(streamClosed,true,'Client cancellation must close the upstream HTTP response in workerd');
  assert.equal((await request('/media/live/unknown')).status,404);
  assert.equal(await kv.get('catalog'),JSON.stringify(catalog),'Public requests must never write the private catalog');
  const before = calls;
  const first = await (await request('/api/sync/plays/1', { headers: { Origin: origin } })).json();
  await new Promise(resolve => setTimeout(resolve, 120));
  const response = await request('/api/sync/plays/1');
  const hit = await response.json();
  assert.equal(hit.checkedAt, first.checkedAt);
  assert.equal(first.schemaVersion,2);
  assert.equal(first.eventId,'1');
  assert.ok(first.ageMs >= 3000);
  assert.ok(hit.ageMs > first.ageMs);
  assert.equal(calls, before + 1, 'Cache hit must avoid another fixture upstream call');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  const statusBefore = calls;
  const statusFirst = await request('/api/sync/status/150/2026', { headers: { Origin: origin, Authorization: 'do-not-forward', Cookie: 'do-not-forward' } });
  assert.equal(statusFirst.status, 200);
  assert.equal(statusFirst.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(statusFirst.headers.get('Cache-Control'), 'no-store');
  const statusData = await statusFirst.json();
  assert.deepEqual(Object.keys(statusData), ['schemaVersion','teamId','season','checkedAt','ageMs','events']);
  assert.deepEqual([statusData.schemaVersion, statusData.teamId, statusData.season], [1, '150', 2026]);
  assert.deepEqual(statusData.events, [{id:'401858255',start:Date.parse('2026-10-10T19:30:00Z'),teams:['Duke','Tulane'],teamIds:['150','2390'],season:2026,status:'upcoming'}]);
  assert.ok(statusData.ageMs >= 2000, 'Age plus Date precision');
  await new Promise(resolve => setTimeout(resolve, 120));
  const statusHit = await (await request('/api/sync/status/150/2026')).json();
  assert.equal(statusHit.checkedAt, statusData.checkedAt);
  assert.ok(statusHit.ageMs > statusData.ageMs);
  assert.equal(calls, statusBefore + 1, 'Status cache hit must avoid another fixture upstream call');
  for (const target of ['/api/sync/status/356/2026', '/api/sync/status/150/2026?season=2025', '/api/sync/status/%31%35%30/2026']) assert.equal((await request(target)).status, 404, target);
  assert.equal(calls, statusBefore + 1, 'Unsupported status targets never reach upstream');
  const boardBefore = calls;
  const liveStatus = await request('/api/sync/status/150/2025', { headers: { Origin: origin } });
  assert.equal(liveStatus.status, 200);
  assert.equal(liveStatus.headers.get('Access-Control-Allow-Origin'), origin);
  const liveText = await liveStatus.text(), liveData = JSON.parse(liveText);
  assert.deepEqual(Object.keys(liveData), ['schemaVersion','teamId','season','checkedAt','ageMs','events'], 'schema 1 envelope is unchanged');
  assert.deepEqual(liveData.events, [{id:'401700001',start:Date.parse('2025-10-11T19:30:00Z'),teams:['Georgia Tech','Duke'],teamIds:['59','150'],season:2025,status:'live',
    scoreboard:{phase:'in-progress',period:2,clock:'7:29',scores:{59:17,150:14}}}]);
  for (const leaked of ['espncdn','logos','abbreviation','homeAway','displayClock','2nd','In Progress']) assert.ok(!liveText.includes(leaked), leaked);
  assert.ok(Number.isSafeInteger(liveData.ageMs));
  assert.equal(calls, boardBefore + 1);
  assert.equal((await request('/api/sync/teams', { headers: { Origin: 'null' } })).status, 403);
  assert.equal((await request('/api/sync/teams?host=evil')).status, 404);
  assert.equal((await request('/api/sync/%74eams')).status, 404);
  assert.equal((await request('/api/sync/teams', { method: 'POST', body: 'ignored' })).status, 405);
  const preflight = await request('/api/sync/teams', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' } });
  assert.equal(preflight.status, 204);
  let prior = calls;
  assert.equal((await request('/api/sync/plays/2')).status, 502);
  assert.equal(calls, prior + 1, 'Redirect must be rejected without a second fetch');
  assert.equal((await request('/api/sync/plays/3')).status, 502);
  assert.equal((await request('/api/sync/plays/4')).status, 502);
  const probe = await mf.getWorker('reader-probe');
  const runtime = await (await probe.fetch('https://probe.invalid')).json();
  assert.deepEqual(runtime, {timeout:true,cancelled:true,cache:'no-store',credentials:'omit',redirect:'manual',combinedSignal:true});
  console.log(JSON.stringify({ result: 'PASS', workerd: JSON.parse(readFileSync('node_modules/workerd/package.json')).version,
    checks: ['private KV catalog projection and audio relay', 'native media cancellation closes upstream HTTP response', 'private catalog read-only on requests', 'upstream headers stripped', 'six HTTP route families', 'array, plays and status body shapes', 'cache hit and age recomputation (plays and status)', 'status supported-team allowlist and minimized envelope', 'synthetic live scoreboard in the unchanged schema 1 status envelope','per-response CORS', 'full target and method rejection', 'restricted preflight', 'no credential forwarding', 'manual redirect rejection without following', 'HTML rejection', '2 MiB cap', 'AbortSignal.any/timeout and body cancellation', 'cache:no-store and credentials:omit runtime compatibility'],
    limitation: 'Local workerd with fixture upstreams; no deployed cache, platform CPU, browser HLS or account entitlement proof.' }, null, 2));
} finally { await mf.dispose(); }
