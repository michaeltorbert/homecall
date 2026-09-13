// Local workerd only: fixture upstreams and an ephemeral HTTP listener. No account access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Miniflare, Response as FixtureResponse } from 'miniflare';
execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--env=', '--dry-run', '--outdir', 'output/worker-dry-run'], { stdio: 'inherit' });
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const bundle = readFileSync('output/worker-dry-run/index.js', 'utf8');
const origin = 'https://michaeltorbert.github.io';
const uuid = '410422f0-663f-4e3d-82e2-787d954ae29d';
let calls = 0;
const upstream = async request => {
  calls++;
  const url = new URL(request.url);
  assert.equal(request.headers.get('Authorization'), null);
  assert.equal(request.headers.get('Cookie'), null);
  if (url.searchParams.get('event') === '2') return FixtureResponse.redirect('https://unexpected.invalid/redirect');
  if (url.hostname === 'unexpected.invalid') throw Error('A redirect must never be followed');
  if (url.searchParams.get('event') === '3') return new FixtureResponse('<html>invalid</html>', { headers: { 'Content-Type': 'text/html' } });
  if (url.searchParams.get('event') === '4') return new FixtureResponse(' '.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } });
  if (url.pathname.endsWith('/summary')) return FixtureResponse.json({header:{id:url.searchParams.get('event'),uid:`s:20~l:23~e:${url.searchParams.get('event')}`,league:{id:'23',slug:'college-football'},season:{year:2026},competitions:[{id:url.searchParams.get('event'),competitors:[{team:{id:'150'}},{team:{id:'356'}}]}]},drives:{previous:[],current:{plays:[]}}}, {headers:{Date:new Date().toUTCString(),Age:'2'}});
  if (url.pathname.endsWith('/schedule')) return FixtureResponse.json({team:{id:'150'},season:{year:2026},events:[]});
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
      env: { ALLOWED_ORIGINS: { type: 'text', value: config.vars.ALLOWED_ORIGINS } }
    }, dev: { outboundService: { type: 'fetcher', handler: upstream } } },
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
  const request = (target, init) => fetch(new URL(target, local), init);
  for (const target of ['/api/homestream/teams', `/api/homestream/games/${uuid}`, '/api/sync/teams', '/api/sync/schedule/150/2026']) {
    const response = await request(target, { headers: { Origin: origin, Authorization: 'do-not-forward', Cookie: 'do-not-forward' } });
    assert.equal(response.status, 200, target);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.ok(Array.isArray(await response.json()));
  }
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
    checks: ['five HTTP route families', 'array and plays body shapes', 'cache hit and age recomputation', 'per-response CORS', 'full target and method rejection', 'restricted preflight', 'no credential forwarding', 'manual redirect rejection without following', 'HTML rejection', '2 MiB cap', 'AbortSignal.any/timeout and body cancellation', 'cache:no-store and credentials:omit runtime compatibility'],
    limitation: 'Local workerd with fixture upstreams; no deployed cache, platform CPU, browser HLS or account entitlement proof.' }, null, 2));
} finally { await mf.dispose(); }
