import { sealMediaTarget, mediaKeyConfigured, RESOURCE_NAME } from './media-token.mjs';
const PLAYLIST_LIMIT = 256 * 1024;
const SIMPLE = new Set(['#EXTM3U', '#EXT-X-VERSION', '#EXT-X-TARGETDURATION', '#EXT-X-MEDIA-SEQUENCE', '#EXT-X-DISCONTINUITY-SEQUENCE', '#EXT-X-DISCONTINUITY', '#EXT-X-ENDLIST', '#EXT-X-PLAYLIST-TYPE', '#EXT-X-I-FRAMES-ONLY', '#EXT-X-INDEPENDENT-SEGMENTS', '#EXT-X-START', '#EXT-X-PROGRAM-DATE-TIME', '#EXT-X-BYTERANGE', '#EXT-X-GAP', '#EXTINF']);
const URI_TAGS = new Set(['#EXT-X-KEY', '#EXT-X-SESSION-KEY', '#EXT-X-MAP', '#EXT-X-MEDIA', '#EXT-X-I-FRAME-STREAM-INF']);
const failure = (status = 502) => new Response('Media unavailable', { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
export function validateMediaTarget(target) {
  if (!target || typeof target.url !== 'string' || target.url.length > 4096 || /[\s\\]/.test(target.url)) throw new Error('Invalid target');
  const url = new URL(target.url);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !host.includes('.') || host.endsWith('.') || /[:\[\]]/.test(host) || /^[\d.]+$/.test(host) || /(?:^|\.)(?:localhost|local|internal|home|lan|test)$/.test(host) || !/^[a-z0-9.-]+$/.test(host)) throw new Error('Invalid target');
  if (!Array.isArray(target.allowedOrigins) || !target.allowedOrigins.includes(url.origin)) throw new Error('Unapproved origin');
  // Reject encoded separators/traversal to avoid disagreement with upstream path decoding.
  if (/%(?:2e|2f|5c|25|00)/i.test(url.pathname)) throw new Error('Invalid path');
  if (target.allowedPaths && (!Array.isArray(target.allowedPaths) || !target.allowedPaths.some(p => typeof p === 'string' && p.startsWith('/') && (url.pathname === p || url.pathname.startsWith(p.endsWith('/') ? p : `${p}/`))))) throw new Error('Unapproved path');
  if (!['audio', 'hls', 'resource', 'key'].includes(target.kind)) throw new Error('Invalid kind');
  return url;
}
// An origin root is never a directory capability; a token must stay narrower than its origin.
function validDirectory(target, directory) {
  try { return validateMediaTarget({ ...target, url: directory, kind: 'resource' }).pathname !== '/'; } catch { return false; }
}
// A playlist whose own name is plain can be reached through a directory capability; the
// public entry then answers with a one-variant master naming that capability form.
export function directoryForm(target) {
  try {
    const url = validateMediaTarget(target);
    if (url.search || url.hash) return null;
    const name = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
    const directory = new URL('.', url.href).href;
    return RESOURCE_NAME.test(name) && directory + name === url.href && validDirectory(target, directory) ? { directory, name } : null;
  } catch { return null; }
}
function requestHeaders(request) {
  const headers = new Headers({ 'Accept-Encoding': 'identity', 'Icy-MetaData': '0' });
  const range = request.headers.get('Range');
  if (range !== null) {
    const match = /^bytes=(\d{1,16})?-(\d{1,16})?$/.exec(range);
    if (!match || (!match[1] && !match[2]) || (match[1] && !Number.isSafeInteger(Number(match[1]))) || (match[2] && !Number.isSafeInteger(Number(match[2]))) || (match[1] && match[2] && Number(match[1]) > Number(match[2])) || (!match[1] && Number(match[2]) === 0)) throw new Error('Invalid Range');
    headers.set('Range', range);
    const ifRange = request.headers.get('If-Range');
    if (ifRange !== null) {
      if (ifRange.length > 128 || !(/^"[\x21\x23-\x7e]{0,100}"$/.test(ifRange) || /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(ifRange))) throw new Error('Invalid If-Range');
      headers.set('If-Range', ifRange);
    }
  }
  return headers;
}
async function boundedText(body, signal) {
  if (!body) throw new Error('Missing playlist');
  const reader = body.getReader(); const chunks = []; let size = 0;
  const abortRead = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abortRead, { once: true });
  if (signal.aborted) abortRead();
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > PLAYLIST_LIMIT) throw new Error('Playlist too large'); chunks.push(value); } }
  catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { signal.removeEventListener('abort', abortRead); }
  if (signal.aborted) throw new Error('Playlist interrupted');
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
async function rewritePlaylist(text, base, target, options) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '#EXTM3U' || lines.length > 4096) throw new Error('Invalid playlist');
  // A live playlist is rewritten every second; scan the whole text once so clean lines skip per-line checks.
  const control = /[\x00-\x08\x0b-\x1f]/.test(text) ? /[\x00-\x08\x0b-\x1f]/ : null;
  const location = /(?:https?:|\/\/|(?:URL|URI)\s*=)/i.test(text) ? /(?:https?:|\/\/|(?:URL|URI)\s*=)/i : null;
  let references = 0; let nextPlaylist = false;
  let pendingRange = null; let previousRange = null;
  const resources = new Map();
  const seal = async (url, kind, scope) => sealMediaTarget({ target: { url, kind, allowedOrigins: [new URL(url).origin], ...(scope ? { scope } : {}) }, sourceId: options.sourceId, version: options.version }, options.secret, { now: options.now, ttlSeconds: options.ttlSeconds });
  // Plain names in the playlist's own directory share one directory capability instead of
  // sealing every segment. When this playlist was itself served through that capability the
  // name is emitted unchanged, so a live playlist stays as small as the provider's.
  const directory = new URL('.', base).href;
  let directoryAllowed;
  let directoryResource;
  const rewrite = async (value, kind = 'resource') => {
    if (++references > 512 || /[\s\\]/.test(value) || value.includes('{$')) throw new Error('Unsupported URI');
    let url, name = null;
    if (RESOURCE_NAME.test(value)) { url = directory + value; name = value; }
    else { url = new URL(value, base).href; if (url.startsWith(directory) && RESOURCE_NAME.test(url.slice(directory.length))) name = url.slice(directory.length); }
    const cacheKey = `${kind}:${url}`;
    if (resources.has(cacheKey)) return resources.get(cacheKey);
    let resource;
    if (name !== null && kind !== 'key' && (kind === 'resource' || /\.m3u8$/i.test(name)) && (directoryAllowed ??= validDirectory(target, directory))) {
      if (options.directory === directory) resource = name;
      else resource = `${directoryResource ??= `${options.gatewayOrigin}/media/resource/${await seal(directory, 'resource', 'directory')}`}/${name}`;
    } else {
      const child = { ...target, url, kind };
      validateMediaTarget(child);
      resource = `${options.gatewayOrigin}/media/resource/${await seal(child.url, child.kind)}`;
    }
    resources.set(cacheKey, resource);
    return resource;
  };
  const output = [];
  for (const line of lines) {
    if (line.length > 8192 || (control && control.test(line))) throw new Error('Invalid playlist');
    if (!line) { output.push(line); continue; }
    if (!line.startsWith('#')) {
      const resolved = new URL(line, base).href;
      if (pendingRange) {
        if (nextPlaylist) throw new Error('Variant cannot have byte range');
        const { length, offset, index } = pendingRange;
        if (offset === null && (!previousRange || previousRange.url !== resolved)) throw new Error('Missing byte range predecessor');
        const start = offset ?? previousRange.end;
        if (!Number.isSafeInteger(start + length)) throw new Error('Byte range exceeds limits');
        output[index] = `#EXT-X-BYTERANGE:${length}@${start}`;
        previousRange = { url: resolved, end: start + length };
        pendingRange = null;
      } else previousRange = null;
      output.push(await rewrite(line, nextPlaylist ? 'hls' : 'resource')); nextPlaylist = false; continue;
    }
    const tag = line.split(':', 1)[0];
    if (URI_TAGS.has(tag)) {
      if (tag === '#EXT-X-MAP' && line.includes('BYTERANGE')) {
        const ranges = [...line.matchAll(/(?:[:,])BYTERANGE="(\d+)@(\d+)"(?=,|$)/g)];
        if (ranges.length !== 1 || (line.match(/BYTERANGE/g) || []).length !== 1 || Number(ranges[0][1]) <= 0 || !Number.isSafeInteger(Number(ranges[0][1]) + Number(ranges[0][2]))) throw new Error('Implicit or invalid map byte range unsupported');
      }
      if ((tag === '#EXT-X-KEY' || tag === '#EXT-X-SESSION-KEY') && (!/(?:^|[:,])METHOD=(?:AES-128|NONE)(?:,|$)/.test(line) || /KEYFORMAT=(?!"identity")/.test(line))) throw new Error('Unsupported encryption');
      const matches = [...line.matchAll(/(?:[:,])URI="([^"\r\n]+)"/g)];
      if (matches.length > 1 || (matches.length === 0 && (tag !== '#EXT-X-MEDIA' && !line.includes('METHOD=NONE')))) throw new Error('Invalid URI attribute');
      let rewritten = line;
      if (matches.length) {
        const match = matches[0]; const kind = ['#EXT-X-MEDIA', '#EXT-X-I-FRAME-STREAM-INF'].includes(tag) ? 'hls' : ['#EXT-X-KEY', '#EXT-X-SESSION-KEY'].includes(tag) ? 'key' : 'resource';
        const uri = await rewrite(match[1], kind);
        rewritten = line.slice(0, match.index) + match[0].replace(match[1], uri) + line.slice(match.index + match[0].length);
      }
      // Attributes other than the supported URI must not smuggle locations.
      if (location && location.test(line.replace(/(?:[:,])URI="[^"\r\n]+"/, ''))) throw new Error('Unsupported URI attribute');
      output.push(rewritten); continue;
    }
    if (tag === '#EXT-X-STREAM-INF') { if (location && /(?:https?:|\/\/|URI\s*=)/i.test(line)) throw new Error('Unsupported URI'); nextPlaylist = true; output.push(line); continue; }
    if (!SIMPLE.has(tag) || (location && location.test(line))) throw new Error('Unsupported playlist tag');
    const value = line.slice(tag.length + 1);
    if (['#EXT-X-VERSION', '#EXT-X-TARGETDURATION', '#EXT-X-MEDIA-SEQUENCE', '#EXT-X-DISCONTINUITY-SEQUENCE'].includes(tag) && !/^\d{1,16}$/.test(value)) throw new Error('Invalid numeric tag');
    if (['#EXTM3U', '#EXT-X-DISCONTINUITY', '#EXT-X-ENDLIST', '#EXT-X-I-FRAMES-ONLY', '#EXT-X-INDEPENDENT-SEGMENTS', '#EXT-X-GAP'].includes(tag) && line !== tag) throw new Error('Invalid flag');
    if (tag === '#EXT-X-PLAYLIST-TYPE' && !/^(EVENT|VOD)$/.test(value)) throw new Error('Invalid playlist type');
    if (tag === '#EXT-X-BYTERANGE') {
      if (!/^\d+(?:@\d+)?$/.test(value) || pendingRange) throw new Error('Invalid byte range');
      const [size, start] = value.split('@');
      const length = Number(size), offset = start === undefined ? null : Number(start);
      if (!Number.isSafeInteger(length) || length <= 0 || (offset !== null && !Number.isSafeInteger(offset))) throw new Error('Invalid byte range');
      pendingRange = { length, offset, index: output.length };
    }
    // ISO 8601 permits a basic-format offset (+0000); the Homestream provider emits it.
    if (tag === '#EXT-X-PROGRAM-DATE-TIME' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) throw new Error('Invalid timestamp');
    if (tag === '#EXT-X-START' && !/^TIME-OFFSET=-?\d+(?:\.\d+)?(?:,PRECISE=(?:YES|NO))?$/.test(value)) throw new Error('Unsupported start tag');
    if (tag === '#EXTINF' && !/^\d+(?:\.\d+)?,/.test(value)) throw new Error('Invalid duration');
    // EXTINF titles are optional provider metadata, not timing.
    output.push(tag === '#EXTINF' ? line.replace(/,.*/, ',') : line);
  }
  if (nextPlaylist || pendingRange) throw new Error('Missing media URI');
  return output.join('\n');
}

async function readWithDeadline(reader, controller, milliseconds) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Media interrupted'));
      void reader.cancel().catch(() => {});
    }, milliseconds);
  });
  try { return await Promise.race([reader.read(), deadline]); }
  finally { clearTimeout(timer); }
}

export async function relayMedia(request, target, { fetcher = fetch, secret, sourceId, version, now = Date.now(), gatewayOrigin = new URL(request.url).origin, headerTimeoutMs = 10000, bodyIdleTimeoutMs = 30000, nativeBody = false, directory = null, ttlSeconds = 3600 } = {}) {
  if (!['GET', 'HEAD'].includes(request.method)) return failure(405);
  let url; let headers;
  try { url = validateMediaTarget(target); headers = requestHeaders(request);
    const gateway = new URL(gatewayOrigin);
    if (gateway.origin !== gatewayOrigin || (gateway.protocol !== 'https:' && !(gateway.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(gateway.hostname)))) throw new Error('Invalid gateway');
  } catch { return failure(400); }
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  const cleanup = () => request.signal.removeEventListener('abort', abort);
  let upstream;
  try {
    for (let hop = 0; ; hop++) {
      const timer = setTimeout(abort, headerTimeoutMs);
      try { upstream = await fetcher(url.href, { method: request.method, headers, redirect: 'manual', signal: controller.signal }); } finally { clearTimeout(timer); }
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      await upstream.body?.cancel().catch(() => {});
      if (hop >= 4 || !upstream.headers.get('Location')) throw new Error('Redirect limit');
      url = validateMediaTarget({ ...target, url: new URL(upstream.headers.get('Location'), url).href });
    }
    if (upstream.status === 404) { await upstream.body?.cancel().catch(() => {}); cleanup(); return failure(404); }
    if (![200, 206, 416].includes(upstream.status) || (upstream.headers.has('icy-metaint') && upstream.headers.get('icy-metaint') !== '0') || (upstream.headers.has('Content-Encoding') && upstream.headers.get('Content-Encoding') !== 'identity')) throw new Error('Unsupported upstream');
    const outputHeaders = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const type = (upstream.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (target.kind === 'key') {
      if (headers.has('Range') || upstream.status !== 200) throw new Error('Partial key unsupported');
      outputHeaders.set('Content-Type', 'application/octet-stream');
      if (request.method === 'HEAD') { await upstream.body?.cancel().catch(() => {}); cleanup(); return new Response(null, { headers: outputHeaders }); }
      if (!upstream.body) throw new Error('Missing key');
      const reader = upstream.body.getReader();
      const chunks = []; let length = 0;
      try {
        for (;;) {
          const { value, done } = await readWithDeadline(reader, controller, bodyIdleTimeoutMs);
          if (done) break;
          length += value.byteLength;
          if (length > 16) throw new Error('Invalid key length');
          chunks.push(value);
        }
        if (length !== 16) throw new Error('Invalid key length');
      } catch (error) { controller.abort(); await reader.cancel().catch(() => {}); throw error; }
      const keyBytes = new Uint8Array(16); let offset = 0;
      for (const chunk of chunks) { keyBytes.set(chunk, offset); offset += chunk.byteLength; }
      outputHeaders.set('Content-Length', '16'); cleanup();
      return new Response(keyBytes, { headers: outputHeaders });
    }
    const isPlaylist = target.kind === 'hls' || ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl'].includes(type) || /\.m3u8$/i.test(url.pathname);
    if (isPlaylist) {
      if (!mediaKeyConfigured(secret)) {
        controller.abort(); await upstream.body?.cancel().catch(() => {}); cleanup();
        return new Response(request.method === 'HEAD' ? null : JSON.stringify({error:'Media configuration unavailable'}), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options':'nosniff' } });
      }
      if (headers.has('Range') || upstream.status !== 200) throw new Error('Partial playlist unsupported');
      outputHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
      if (request.method === 'HEAD') { await upstream.body?.cancel().catch(() => {}); cleanup(); return new Response(null, { headers: outputHeaders }); }
      const timer = setTimeout(abort, headerTimeoutMs);
      let rewritten;
      try { rewritten = await rewritePlaylist(await boundedText(upstream.body, controller.signal), url, target, { secret, sourceId, version, now, gatewayOrigin, directory, ttlSeconds }); } finally { clearTimeout(timer); }
      cleanup(); return new Response(rewritten, { headers: outputHeaders });
    }
    if (upstream.status !== 416 && !/^(?:audio\/[a-z0-9.+-]+|video\/(?:mp2t|mp4)|application\/octet-stream)$/.test(type)) throw new Error('Unsupported media type');
    if (upstream.status !== 416) outputHeaders.set('Content-Type', type);
    for (const name of ['Content-Length', 'Content-Range', 'Accept-Ranges']) {
      const value = upstream.headers.get(name);
      if (value !== null && ((name === 'Content-Length' && /^\d{1,16}$/.test(value)) || (name === 'Content-Range' && /^bytes (?:\d+-\d+|\*)\/(?:\d+|\*)$/.test(value)) || (name === 'Accept-Ranges' && /^(bytes|none)$/.test(value)))) outputHeaders.set(name, value);
    }
    if (upstream.status === 206 && !outputHeaders.has('Content-Range')) throw new Error('Invalid partial response');
    if (request.method === 'HEAD' || upstream.status === 416 || !upstream.body) {
      await upstream.body?.cancel().catch(() => {}); cleanup();
      if (upstream.status === 416) outputHeaders.delete('Content-Length');
      return new Response(null, { status: upstream.status, headers: outputHeaders });
    }
    // Workers can forward opaque bodies natively without invoking JS per chunk.
    // Downstream cancellation cancels that body; client stall watchdogs own idle
    // recovery on this path. Header, playlist and key deadlines remain bounded.
    if (nativeBody) { cleanup(); return new Response(upstream.body, { status: upstream.status, headers: outputHeaders }); }
    const reader = upstream.body.getReader();
    const body = new ReadableStream({
      async pull(destination) { try { const result = await readWithDeadline(reader, controller, bodyIdleTimeoutMs); if (result.done) { cleanup(); destination.close(); } else destination.enqueue(result.value); } catch { controller.abort(); cleanup(); destination.error(new Error('Media interrupted')); } },
      async cancel() { controller.abort(); cleanup(); await reader.cancel().catch(() => {}); },
    });
    return new Response(body, { status: upstream.status, headers: outputHeaders });
  } catch { controller.abort(); cleanup(); await upstream?.body?.cancel().catch(() => {}); return failure(); }
}
