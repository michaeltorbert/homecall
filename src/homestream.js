import { mediaURL, configuredGatewayOrigin, gatewayOptions, validateGatewayOrigin } from './gateway.js';
export { mediaURL } from './gateway.js';
export async function readJSON(url, { signal, fetcher = fetch } = {}) {
  const response = await fetcher(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), credentials: 'omit', redirect: 'error', cache: 'no-store' });
  if (!response.ok) throw Error('catalog-unavailable');
  return response.json();
}
export function playlistState(text) {
  if (!text.trimStart().startsWith('#EXTM3U')) throw Error('playlist-invalid');
  const segments = text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  const sequence = Number(text.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/m)?.[1]);
  const duration = Number(text.match(/^#EXT-X-TARGETDURATION:(\d+)/m)?.[1]);
  if (!segments.length || !Number.isFinite(sequence) || !Number.isFinite(duration) || duration < 1 || duration > 30 || !text.includes('#EXTINF:')) throw Error('playlist-invalid');
  return { sequence, segments, duration, ended: text.includes('#EXT-X-ENDLIST') };
}
export function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export async function checkPlaylist(url, { signal, fetcher = fetch, sleep = wait, origin, allowLocal } = {}) {
  if (!mediaURL(url, { origin, allowLocal })) return 'unpublished';
  let mediaEndpoint = url;
  function resourceURL(value) {
    try {
      const gateway = validateGatewayOrigin(origin ?? configuredGatewayOrigin(), { allowLocal: allowLocal ?? gatewayOptions().allowLocal, required: true });
      const parsed = new URL(value);
      return parsed.origin === gateway && /^\/media\/resource\/[A-Za-z0-9_-]{1,16100}(?:\/[A-Za-z0-9_.-]{1,255})?$/.test(parsed.pathname) && value === `${gateway}${parsed.pathname}` ? value : null;
    } catch { return null; }
  }
  async function sample() {
    for (let depth = 0; depth <= 3; depth++) {
      const response = await fetcher(mediaEndpoint, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), cache: 'no-store', credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw Error(response.status === 404 ? 'missing' : 'unavailable');
      const text = await response.text();
      if (text.length > 256 * 1024 || !text.trimStart().startsWith('#EXTM3U')) throw Error('playlist-invalid');
      if (!/^#EXT-X-STREAM-INF:/m.test(text)) return playlistState(text);
      const lines = text.split(/\r?\n/).map(line => line.trim());
      const index = lines.findIndex(line => line.startsWith('#EXT-X-STREAM-INF:'));
      const child = lines.slice(index + 1).find(line => line && !line.startsWith('#'));
      // A master served through a directory capability names same-directory variants relatively.
      let resolved = null; try { resolved = child && !/[\s\\]/.test(child) ? new URL(child, mediaEndpoint).href : null; } catch {}
      const next = resourceURL(resolved);
      if (!next || depth === 3) throw Error('playlist-invalid');
      mediaEndpoint = next;
    }
    throw Error('playlist-invalid');
  }
  try {
    const first = await sample();
    if (first.ended) return 'ended';
    await sleep(Math.max(3000, first.duration * 2000), signal);
    const second = await sample();
    if (second.ended) return 'ended';
    return second.sequence > first.sequence || (second.sequence === first.sequence && second.segments.length > first.segments.length) ? 'ready' : 'stalled';
  } catch (error) {
    if (signal?.aborted) throw error;
    return error.message === 'missing' ? 'missing' : 'unavailable';
  }
}
