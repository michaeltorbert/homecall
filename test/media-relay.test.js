import test from 'node:test';
import assert from 'node:assert/strict';
import { relayMedia, validateMediaTarget } from '../lib/media-relay.mjs';
import { openMediaTarget } from '../lib/media-token.mjs';
const secret = Buffer.alloc(32, 17).toString('base64url');
const target = { url: 'https://audio.example/live', allowedOrigins: ['https://audio.example'], kind: 'audio' };
const request = (options) => new Request('https://gateway.example/media/live/station', options);
const opts = { secret, sourceId: 'station', version: 'v1', now: 1000 };
test('cleanup of errored upstream bodies preserves validated status and redirects', async () => {
  const errored = () => new ReadableStream({start(c){c.error(new Error('private provider detail'));}});
  for(const [status,method,kind] of [[404,'GET','audio'],[200,'HEAD','audio'],[416,'GET','audio'],[200,'HEAD','hls'],[200,'HEAD','key']]) {
    const r=await relayMedia(request({method}),{...target,kind},{...opts,fetcher:async()=>new Response(errored(),{status,headers:{'Content-Type':'audio/mpeg'}})});
    assert.equal(r.status,status);assert.ok(!(await r.text()).includes('private provider detail'));
  }
  let calls=0;
  const redirected=await relayMedia(request(),target,{...opts,fetcher:async()=>++calls===1
    ?new Response(errored(),{status:302,headers:{Location:'https://audio.example/next'}})
    :new Response('audio',{headers:{'Content-Type':'audio/mpeg'}})});
  assert.equal(redirected.status,200);assert.equal(await redirected.text(),'audio');assert.equal(calls,2);
});
test('stream relay forwards only allowed request/response headers and cancellation', async () => {
  let signal; let cancelled = false; let init;
  const upstream = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } });
  const result = await relayMedia(request({ headers: { Cookie: 'private', Authorization: 'private', Range: 'bytes=0-9', 'If-Range': '"test"' } }), target, { ...opts, fetcher: async (_, options) => {
    init = options; signal = options.signal;
    return new Response(upstream, { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 0-9/20', 'Location': 'https://audio.example/private', 'icy-url': 'https://audio.example', 'Link': 'private', 'Set-Cookie': 'private' } });
  } });
  assert.equal(result.status, 206); assert.equal(init.headers.get('Range'), 'bytes=0-9');
  assert.equal(init.headers.get('Cookie'), null); assert.equal(init.headers.get('Authorization'), null);
  assert.equal(result.headers.get('Location'), null); assert.equal(result.headers.get('icy-url'), null); assert.equal(result.headers.get('Link'), null);
  await result.body.cancel(); assert.equal(cancelled, true); assert.equal(signal.aborted, true);
});
test('invalid range is rejected before fetch', async () => {
  for (const range of ['bytes=1-0', 'bytes=-0', 'bytes=0-1,4-5', 'items=0-1', 'bytes=-', 'bytes=9999999999999999-']) {
    const response = await relayMedia(request({ headers: { Range: range } }), target, { fetcher() { assert.fail('must not fetch'); } });
    assert.equal(response.status, 400);
  }
});
test('redirects validate every destination and errors never disclose targets', async () => {
  let calls = 0;
  const response = await relayMedia(request(), target, { fetcher: async () => { calls++; return new Response('secret upstream', { status: 302, headers: { Location: 'https://evil.example/audio' } }); } });
  assert.equal(calls, 1); assert.equal(response.status, 502); assert.equal(await response.text(), 'Media unavailable');
  const error = await relayMedia(request(), target, { fetcher: async () => new Response('https://audio.example/private', { status: 403 }) });
  assert.equal(await error.text(), 'Media unavailable');
});
test('target validation rejects internal IPs credentials path escapes and unapproved ports', () => {
  for (const url of ['https://127.0.0.1/a', 'https://[::1]/a', 'https://localhost/a', 'https://node.internal/a', 'https://user:pass@audio.example/live', 'https://audio.example:9050/live', 'https://audio.example/private/%2fescape']) assert.throws(() => validateMediaTarget({ ...target, url }));
  assert.equal(validateMediaTarget({ ...target, url: 'https://audio.example:9050/live', allowedOrigins: ['https://audio.example:9050'] }).port, '9050');
  assert.throws(() => validateMediaTarget({ ...target, url: 'https://audio.example/lively', allowedPaths: ['/live'] }));
});
test('HEAD and unsatisfied ranges suppress upstream bodies', async () => {
  for (const status of [200, 416]) {
    const response = await relayMedia(request({ method: 'HEAD' }), target, { fetcher: async (_, init) => {
      assert.equal(init.method, 'HEAD'); return new Response(null, { status, headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes */20', 'Content-Length': '123' } });
    } });
    assert.equal(response.status, status); assert.equal(await response.text(), ''); assert.equal(response.headers.get('Content-Length'), status === 416 ? null : '123');
  }
});
test('HLS rewrite preserves timing, sequence, discontinuity, ranges and encrypts each target', async () => {
  const playlist = '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-MEDIA-SEQUENCE:45\n#EXT-X-DISCONTINUITY-SEQUENCE:2\n#EXT-X-TARGETDURATION:6\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4",BYTERANGE="128@0"\n#EXT-X-PROGRAM-DATE-TIME:2026-09-18T12:00:00Z\n#EXTINF:6,\n#EXT-X-BYTERANGE:100@128\nsegment.m4s?sig=private\n#EXT-X-DISCONTINUITY\n#EXTINF:6,\nnext.m4s\n';
  const response = await relayMedia(request(), { ...target, url: 'https://audio.example/list/main.m3u8', kind: 'hls' }, { ...opts, fetcher: async () => new Response(playlist) });
  assert.equal(response.status, 200); const text = await response.text();
  assert.ok(!text.includes('audio.example')); assert.ok(!text.includes('sig=private'));
  for (const line of playlist.split('\n').filter(l => /PROGRAM-DATE|SEQUENCE|DISCONTINUITY|BYTERANGE|EXTINF/.test(l) && !l.includes('URI='))) assert.ok(text.includes(line));
  const tokens = [...text.matchAll(/https:\/\/gateway.example\/media\/resource\/([\w-]+)/g)]; assert.equal(tokens.length, 4);
  const decoded = await Promise.all(tokens.map(m => openMediaTarget(m[1], secret, { now: 1000 })));
  assert.equal(decoded[2].target.url, 'https://audio.example/list/segment.m4s?sig=private');
});
test('HLS handles nested variants and rejects unsupported, malicious or oversized playlists', async () => {
  const good = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="alternate.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nchild.m3u8\n';
  const relay = async body => relayMedia(request(), { ...target, kind: 'hls' }, { ...opts, fetcher: async () => new Response(body) });
  const text = await (await relay(good)).text();
  for (const match of text.matchAll(/\/media\/resource\/([\w-]+)/g)) assert.equal((await openMediaTarget(match[1], secret, { now: 1000 })).target.kind, 'hls');
  for (const body of ['#EXTM3U\nhttps://evil.example/a', '#EXTM3U\n# comment https://audio.example/private', '#EXTM3U\n#EXT-X-PART:URI="a"', '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="a"', '#EXTM3U\n#EXT-X-SESSION-DATA:URI="a"', '#EXTM3U\n' + 'a'.repeat(300000)]) assert.equal((await relay(body)).status, 502);
});
test('request abort propagates and bounded header timeout terminates fetch', async () => {
  const aborter = new AbortController(); let signal;
  const pending = relayMedia(request({ signal: aborter.signal }), target, { fetcher: (_, init) => { signal = init.signal; return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('secret error')))); } });
  aborter.abort(); assert.equal((await pending).status, 502); assert.ok(signal.aborted);
  const timed = await relayMedia(request(), target, { headerTimeoutMs: 5, fetcher: (_, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout')))) });
  assert.equal(timed.status, 502);
});
test('ICY metadata is refused rather than leaking embedded provider metadata', async () => {
  const response = await relayMedia(request(), target, { fetcher: async () => new Response('metadata', { headers: { 'Content-Type': 'audio/mpeg', 'icy-metaint': '16000' } }) });
  assert.equal(response.status, 502);
});
test('body interruption aborts upstream and sanitizes read errors', async () => {
  let signal; let upstreamController;
  const response = await relayMedia(request(), target, { fetcher: async (_, init) => {
    signal = init.signal;
    return new Response(new ReadableStream({ start(c) { upstreamController = c; } }), { headers: { 'Content-Type': 'audio/mpeg' } });
  } });
  const read = response.body.getReader().read();
  upstreamController.error(new Error('https://audio.example/private'));
  await assert.rejects(read, /^Error: Media interrupted$/); assert.ok(signal.aborted);
});
test('playlist body deadline cancels stalled reads', async () => {
  let cancelled = false;
  const response = await relayMedia(request(), { ...target, kind: 'hls' }, { ...opts, headerTimeoutMs: 5, fetcher: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) });
  assert.equal(response.status, 502); assert.ok(cancelled);
});
test('encoded media is refused to avoid forwarding invalid byte lengths', async () => {
  const response = await relayMedia(request(), target, { fetcher: async () => new Response('bytes', { headers: { 'Content-Type': 'audio/mpeg', 'Content-Encoding': 'gzip' } }) });
  assert.equal(response.status, 502);
});
test('HLS makes implicit byte ranges explicit and shares tokens for identical resources', async () => {
  const playlist = '#EXTM3U\n#EXT-X-MAP:URI="chunk.mp4",BYTERANGE="100@0"\n#EXTINF:6,\n#EXT-X-BYTERANGE:200@100\nchunk.mp4\n#EXTINF:6,\n#EXT-X-BYTERANGE:300\n./chunk.mp4\n#EXTINF:6,\n#EXT-X-BYTERANGE:400\nchunk.mp4\n';
  const response = await relayMedia(request(), { ...target, kind: 'hls' }, { ...opts, fetcher: async () => new Response(playlist) });
  assert.equal(response.status, 200); const text = await response.text();
  assert.ok(text.includes('#EXT-X-BYTERANGE:200@100')); assert.ok(text.includes('#EXT-X-BYTERANGE:300@300')); assert.ok(text.includes('#EXT-X-BYTERANGE:400@600'));
  const tokens = [...text.matchAll(/\/media\/resource\/([\w-]+)/g)].map(m => m[1]);
  assert.equal(tokens.length, 4); assert.equal(new Set(tokens).size, 1);
});
test('HLS rejects undefined implicit ranges and implicit MAP ranges', async () => {
  for (const body of [
    '#EXT-X-BYTERANGE:10\nchunk.mp4',
    '#EXT-X-BYTERANGE:10@0\na.mp4\n#EXT-X-BYTERANGE:10\nb.mp4',
    '#EXT-X-BYTERANGE:10@0\na.mp4\na.mp4\n#EXT-X-BYTERANGE:10\na.mp4',
    '#EXT-X-BYTERANGE:10@0',
    '#EXT-X-BYTERANGE:0@0\na.mp4',
    '#EXT-X-BYTERANGE:9007199254740991@2\na.mp4',
    '#EXT-X-MAP:URI="init.mp4",BYTERANGE="100"',
    '#EXT-X-MAP:URI="init.mp4",BYTERANGE="0@0"',
  ]) {
    const response = await relayMedia(request(), { ...target, kind: 'hls' }, { ...opts, fetcher: async () => new Response(`#EXTM3U\n${body}`) });
    assert.equal(response.status, 502, body);
  }
});

test('zero ICY interval allows audio while requesting metadata disabled', async () => {
  const response = await relayMedia(new Request('https://gateway.example/media/live/station'), {url:'https://audio.example/live',allowedOrigins:['https://audio.example'],kind:'audio'}, {fetcher:async(url,options)=>{
    assert.equal(options.headers.get('Icy-MetaData'),'0');
    return new Response('audio',{headers:{'Content-Type':'audio/mpeg','icy-metaint':'0'}});
  }});
  assert.equal(response.status,200);assert.equal(await response.text(),'audio');assert.equal(response.headers.has('icy-metaint'),false);
});
test('playlist capabilities contain only the child origin and retain key purpose', async () => {
  const policy = { ...target, kind: 'hls', allowedOrigins: ['https://audio.example', 'https://backup.example'], allowedPaths: ['/'] };
  const response = await relayMedia(request(), policy, { ...opts, fetcher: async () => new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="secret.key"\n#EXTINF:6,\nsegment.ts\n') });
  assert.equal(response.status, 200);
  const tokens = [...(await response.text()).matchAll(/\/media\/resource\/([\w-]+)/g)].map(m => m[1]);
  const payload = await openMediaTarget(tokens[0], secret, { now: 1000 });
  assert.equal(payload.target.kind, 'key'); assert.deepEqual(payload.target.allowedOrigins, ['https://audio.example']); assert.equal(payload.target.allowedPaths, undefined);
});
test('AES keys require exactly 16 bytes independent of missing or text MIME', async () => {
  for (const headers of [{}, { 'Content-Type': 'text/plain' }]) {
    const response = await relayMedia(request(), { ...target, kind: 'key' }, { ...opts, fetcher: async () => new Response(new Uint8Array(16).fill(91), { headers }) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'application/octet-stream'); assert.equal((await response.arrayBuffer()).byteLength, 16);
  }
  for (const body of [new Uint8Array(15), new Uint8Array(17), '<html><body>Provider failure</body></html>']) {
    const response = await relayMedia(request(), { ...target, kind: 'key' }, { ...opts, fetcher: async () => new Response(body) });
    assert.equal(response.status, 502); assert.equal(await response.text(), 'Media unavailable');
  }
  const partial = await relayMedia(request({ headers: { Range: 'bytes=0-15' } }), { ...target, kind: 'key' }, { ...opts, fetcher: async () => new Response(new Uint8Array(16), { status: 206 }) });
  assert.equal(partial.status, 502);
  const head = await relayMedia(request({ method: 'HEAD' }), { ...target, kind: 'key' }, { ...opts, fetcher: async () => new Response(null) });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
});
test('media body idle timeout aborts and cancels the stalled upstream', async () => {
  let signal; let cancelled = false;
  const response = await relayMedia(request(), target, { bodyIdleTimeoutMs: 5, fetcher: async (_, init) => {
    signal = init.signal;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'audio/mpeg' } });
  } });
  await assert.rejects(response.arrayBuffer(), /Media interrupted/); assert.ok(signal.aborted); assert.ok(cancelled);
});
test('body idle deadline restarts after each received chunk', async () => {
  let sent = 0;
  const response = await relayMedia(request(), target, { bodyIdleTimeoutMs: 100, fetcher: async () => new Response(new ReadableStream({ async pull(c) {
    if (sent++ === 3) { c.close(); return; }
    await new Promise(resolve => setTimeout(resolve, 50)); c.enqueue(new Uint8Array([1]));
  } }), { headers: { 'Content-Type': 'audio/mpeg' } }) });
  assert.equal((await response.arrayBuffer()).byteLength, 3);
});
test('missing media preserves sanitized 404 for unpublished HLS state', async () => {
  const response = await relayMedia(request(), { ...target, kind: 'hls' }, { ...opts, fetcher: async () => new Response('https://audio.example/private', { status: 404, headers: { Location: 'https://audio.example/private' } }) });
  assert.equal(response.status, 404); assert.equal(await response.text(), 'Media unavailable'); assert.equal(response.headers.get('Location'), null);
});
test('HLS accepts the provider\'s basic-format timestamp offset and a one-second live window', async () => {
  // Mirrors the Homestream media playlist observed on 2026-09-19: version 3, one-second segments, +0000 offsets, 350 entries.
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:1', '#EXT-X-MEDIA-SEQUENCE:583'];
  for (let i = 0; i < 350; i++) lines.push(`#EXTINF:0.99845${i % 10},`, `#EXT-X-PROGRAM-DATE-TIME:2026-09-19T15:40:${String(i % 60).padStart(2, '0')}.490+0000`, `segment_${583 + i}.ts`);
  const relay = async body => relayMedia(request(), { ...target, url: 'https://audio.example/live/index.m3u8', kind: 'hls' }, { ...opts, fetcher: async () => new Response(body) });
  const response = await relay(lines.join('\n') + '\n');
  assert.equal(response.status, 200); const text = await response.text();
  assert.equal((text.match(/#EXT-X-PROGRAM-DATE-TIME:2026-09-19T15:40:\d{2}\.490\+0000/g) || []).length, 350);
  assert.equal((text.match(/\/media\/resource\//g) || []).length, 350); assert.ok(!text.includes('audio.example'));
  for (const bad of ['2026-09-19T15:40:22.490+00', '2026-09-19T15:40:22.490 +0000', '2026-09-19T15:40:22.490+00:0', '2026-09-19 15:40:22Z']) assert.equal((await relay(`#EXTM3U\n#EXT-X-PROGRAM-DATE-TIME:${bad}\n#EXTINF:1,\na.ts\n`)).status, 502);
});
