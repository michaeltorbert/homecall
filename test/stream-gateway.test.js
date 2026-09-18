import test from 'node:test';
import assert from 'node:assert/strict';
import { streamGateway } from '../lib/stream-gateway.mjs';
import { sealMediaTarget } from '../lib/media-token.mjs';
const stamp = '2026-09-01T00:00:00.000Z';
const origin = 'https://app.example';
const secret = Buffer.alloc(32, 29).toString('base64url');
const team = '12345678-1234-1234-1234-123456789abc';
const mediaTarget = { url: 'https://audio.example/live?private=canary', allowedOrigins: ['https://audio.example'], kind: 'audio' };
function fixture() {
  const catalog = { schemaVersion: 1, version: stamp, updatedAt: stamp, live: { duke: mediaTarget }, archive: { checkedAt: stamp, schools: { duke: { source: 'https://school.example/', status: 'ready', items: [{ id: 'recording', opponent: 'Visitor', sport: 'Football', start: stamp, kind: 'Game recording', url: 'https://audio.example/replay/123.mp3' }] } } }, archiveConfig: { replayRules: { duke: [{ origin: 'https://audio.example', pathPrefix: '/replay/', filenamePattern: '^\\d+\\.mp3$' }] } }, discovery: { homestreamBase: 'https://discovery.example', mediaOrigins: ['https://audio.example'] } };
  let reads = 0, writes = 0;
  const env = { MEDIA_TOKEN_KEY: secret, STREAM_CATALOG: { get: async key => { assert.equal(key, 'catalog'); reads++; return JSON.stringify(catalog); }, put: async () => { writes++; assert.fail('Public request must never write KV'); } } };
  return { catalog, env, reads: () => reads, writes: () => writes };
}
function req(path, init = {}) { return new Request(`https://gateway.example${path}`, init); }
const options = fetcher => ({ origins: [origin], fetcher });
const audio = () => new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'audio/mpeg' } });
test('missing or malformed media keys identify configuration failures without disabling catalogs or MP3', async () => {
  for (const key of [undefined, '', 'not-a-key', Buffer.alloc(31).toString('base64url'), secret + '=']) {
    const f = fixture(); f.env.MEDIA_TOKEN_KEY = key;
    for (const path of [`/media/game/${team}/match`, '/media/resource/invalid']) {
      const response = await streamGateway(req(path, {headers:{Origin:origin}}), f.env, options(() => assert.fail('No upstream request for missing configuration')));
      assert.equal(response.status,503); assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
      assert.deepEqual(await response.json(),{error:'Media configuration unavailable'});
    }
    assert.equal((await streamGateway(req('/api/catalog/live'),f.env,options(audio))).status,200);
    const mp3=await streamGateway(req('/media/live/duke'),f.env,options(audio));
    assert.equal(mp3.status,200); await mp3.arrayBuffer();
    for (const method of ['GET','HEAD']) {
      const playlist=await streamGateway(req('/media/live/duke',{method,headers:{Origin:origin}}),f.env,options(() => new Response('#EXTM3U\n#EXTINF:6,\nsegment.ts\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}})));
      assert.equal(playlist.status,503); assert.equal(playlist.headers.get('Access-Control-Allow-Origin'),origin);
      assert.equal(await playlist.text(),method==='HEAD'?'':JSON.stringify({error:'Media configuration unavailable'}));
    }
  }
});
test('configuration 503 survives cancellation of a body errored by abort', async () => {
  const f=fixture(); delete f.env.MEDIA_TOKEN_KEY;
  const response=await streamGateway(req('/media/live/duke'),f.env,options((_,init) => new Response(new ReadableStream({
    start(controller) {init.signal.addEventListener('abort',()=>controller.error(new Error('private upstream error')),{once:true});}
  }),{headers:{'Content-Type':'application/vnd.apple.mpegurl'}})));
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Media configuration unavailable'});
});
test('native media response preserves cancellation and sanitized headers through the gateway', async () => {
  const f=fixture();let cancelled=false;
  const response=await streamGateway(req('/media/live/duke'),f.env,{...options(() => new Response(new ReadableStream({
    pull(c){c.enqueue(new Uint8Array([1,2]));},cancel(){cancelled=true;}
  }),{headers:{'Content-Type':'audio/mpeg','Location':'https://audio.example/private'}})),nativeBody:true});
  assert.equal(response.status,200);assert.equal(response.headers.get('Location'),null);
  const reader=response.body.getReader();assert.deepEqual([...((await reader.read()).value)],[1,2]);
  await reader.cancel();assert.equal(cancelled,true);
});
test('gateway projects both catalogs without upstream addresses or private configuration', async () => {
  const f = fixture();
  for (const path of ['/api/catalog/live', '/api/catalog/archive']) {
    const response = await streamGateway(req(path, { headers: { Origin: origin } }), f.env, options(() => assert.fail('Catalog must not fetch media')));
    assert.equal(response.status, 200); assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    const text = await response.text();
    for (const secretValue of ['audio.example', 'discovery.example', 'private=canary', 'allowedOrigins', 'archiveConfig']) assert.ok(!text.includes(secretValue));
    assert.ok(text.includes('https://gateway.example/media/'));
  }
  assert.equal(f.writes(), 0); assert.equal(f.reads(), 2);
});
test('gateway method, origin and preflight checks run before KV access', async () => {
  const f = fixture();
  const cases = [
    [{ method: 'POST' }, 405],
    [{ headers: { Origin: 'https://evil.example' } }, 403],
    [{ method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Range, If-Range' } }, 204],
    [{ method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } }, 403],
    [{ method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization' } }, 403],
    [{ method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'GET' } }, 403],
  ];
  for (const [init, status] of cases) assert.equal((await streamGateway(req('/media/live/duke', init), f.env, options(() => assert.fail()))).status, status);
  assert.equal(f.reads(), 0);
});
test('gateway supports no-Origin media and HEAD without broadening CORS', async () => {
  const f = fixture();
  const response = await streamGateway(req('/media/live/duke'), f.env, options(audio));
  assert.equal(response.status, 200); assert.equal(response.headers.get('Access-Control-Allow-Origin'), null); assert.equal((await response.arrayBuffer()).byteLength, 2);
  const head = await streamGateway(req('/media/live/duke', { method: 'HEAD' }), f.env, options((_, init) => { assert.equal(init.method, 'HEAD'); return audio(); }));
  assert.equal(head.status, 200); assert.equal(await head.text(), ''); assert.equal(f.writes(), 0);
});
test('gateway strict routes reject queries extra segments and prototype IDs', async () => {
  const f = fixture();
  for (const path of ['/media/live/duke?url=https://evil.example', '/api/catalog/live?x=1', '/media/live/duke/extra', '/media/archive/duke/recording?x=1', '/media/live/__proto__', '/media/archive/__proto__/recording']) {
    assert.equal((await streamGateway(req(path), f.env, options(() => assert.fail()))).status, 404);
  }
  assert.equal(f.writes(), 0);
});
test('gateway decrypts scoped resources while rejecting tampering, expiry, versions and origins', async () => {
  const f = fixture(); let calls = 0;
  const payload = { sourceId: `game-${team}-match`, version: stamp, target: mediaTarget };
  async function deliver(data, tokenOptions) {
    const token = await sealMediaTarget(data, secret, tokenOptions);
    return streamGateway(req(`/media/resource/${token}`), f.env, options(() => { calls++; return audio(); }));
  }
  const good = await deliver(payload); assert.equal(good.status, 200); await good.arrayBuffer(); assert.equal(calls, 1);
  for (const bad of [{ ...payload, version: 'old-version' }, { ...payload, sourceId: 'unknown-station' }, { ...payload, target: { ...mediaTarget, url: 'https://evil.example/media', allowedOrigins: ['https://evil.example'] } }]) assert.notEqual((await deliver(bad)).status, 200);
  assert.notEqual((await deliver(payload, { now: 0, ttlSeconds: 1 })).status, 200);
  const token = await sealMediaTarget(payload, secret); const bytes = Buffer.from(token, 'base64url'); bytes[20] ^= 1;
  assert.notEqual((await streamGateway(req(`/media/resource/${bytes.toString('base64url')}`), f.env, options(() => assert.fail()))).status, 200);
  assert.equal(calls, 1); assert.equal(f.writes(), 0);
});
test('gateway rejects malformed game identity even on an authenticated resource token', async () => {
  const f = fixture();
  const token = await sealMediaTarget({ sourceId: 'game-unrecognized', version: stamp, target: mediaTarget }, secret);
  const response = await streamGateway(req(`/media/resource/${token}`), f.env, options(() => { assert.fail('Malformed scope must not reach upstream'); }));
  assert.equal(response.status, 403);
});
test('gateway preserves downstream cancellation through its response wrapper', async () => {
  const f = fixture(); let cancelled = false; let signal;
  const response = await streamGateway(req('/media/live/duke'), f.env, options((_, init) => {
    signal = init.signal; return new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'audio/mpeg', 'Location': 'https://audio.example/private' } });
  }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('Location'), null);
  await response.body.cancel(); assert.ok(cancelled); assert.ok(signal.aborted); assert.equal(f.writes(), 0);
});
test('archive gateway preserves Range and partial response semantics', async () => {
  const f = fixture();
  const response = await streamGateway(req('/media/archive/duke/recording', { headers: { Origin: origin, Range: 'bytes=1-2', 'If-Range': '"version"', Cookie: 'private' } }), f.env, options((url, init) => {
    assert.equal(url, 'https://audio.example/replay/123.mp3'); assert.equal(init.headers.get('Range'), 'bytes=1-2'); assert.equal(init.headers.get('If-Range'), '"version"'); assert.equal(init.headers.get('Cookie'), null);
    return new Response(new Uint8Array([2, 3]), { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 1-2/4', 'Accept-Ranges': 'bytes', 'Content-Length': '2' } });
  }));
  assert.equal(response.status, 206); assert.equal(response.headers.get('Content-Range'), 'bytes 1-2/4'); assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin); assert.equal((await response.arrayBuffer()).byteLength, 2); assert.equal(f.writes(), 0);
});

test('live and archive playlists issue usable resources without discovery configuration', async () => {
  for (const path of ['/media/live/duke', '/media/archive/duke/recording']) {
    const f = fixture(); delete f.catalog.discovery;
    const playlist = await streamGateway(req(path), f.env, options(() => new Response('#EXTM3U\n#EXTINF:6,\nsegment.ts\n', { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } })));
    assert.equal(playlist.status, 200);
    const resource = (await playlist.text()).split('\n').find(line => line.startsWith('https:'));
    assert.ok(resource.startsWith('https://gateway.example/media/resource/'));
    const delivered = await streamGateway(new Request(resource), f.env, options(audio));
    assert.equal(delivered.status, 200); assert.equal((await delivered.arrayBuffer()).byteLength, 2);
  }
});
test('existing live capabilities respect current source presence origins and path policy', async () => {
  const f = fixture();
  const token = await sealMediaTarget({sourceId:'duke',version:stamp,target:{...mediaTarget,url:'https://audio.example/previous/segment.ts',kind:'resource'}},secret);
  const request = () => req(`/media/resource/${token}`);
  f.catalog.live.duke = {...mediaTarget,allowedPaths:['/current']};
  assert.notEqual((await streamGateway(request(),f.env,options(()=>assert.fail('Tightened path policy must block upstream')))).status,200);
  f.catalog.live.duke = {...mediaTarget,url:'https://new.example/live',allowedOrigins:['https://new.example']};
  assert.equal((await streamGateway(request(),f.env,options(()=>assert.fail('Changed origin must block upstream')))).status,403);
  delete f.catalog.live.duke;
  assert.equal((await streamGateway(request(),f.env,options(()=>assert.fail('Removed source must block upstream')))).status,403);
});
