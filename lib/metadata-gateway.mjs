import { syncData } from './sync-data.mjs';
import { homestreamCatalog } from './homestream-catalog.mjs';
export const PRODUCTION_ORIGIN = 'https://michaeltorbert.github.io';
export const LOCAL_ORIGINS = ['http://127.0.0.1:4178', 'http://localhost:4178', 'http://127.0.0.1:4179', 'http://localhost:4179'];
export const TEAM_UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const routes = [
  [/^\/api\/homestream\/teams$/, 3600, homestreamCatalog],
  [new RegExp(`^/api/homestream/games/${TEAM_UUID}$`), 15, homestreamCatalog],
  [/^\/api\/sync\/teams$/, 3600, syncData],
  [/^\/api\/sync\/schedule\/\d{1,10}\/20\d{2}$/, 300, syncData],
  [/^\/api\/sync\/plays\/\d{1,12}$/, 10, syncData]
];
export function metadataRoute(target) {
  return routes.find(([pattern]) => pattern.test(target));
}
// The full target is checked, including query/percent-encoded variants. Node passes
// its raw req.url so URL normalization cannot silently turn a bad target into one.
export async function metadataGateway(request, { target = request.url.replace(/^https?:\/\/[^/]+/, ''), method = request.method, origins = [PRODUCTION_ORIGIN], fetcher = fetch, cache, ctx, now = Date.now, diagnostic = () => {}, catalog, gatewayOrigin = new URL(request.url).origin } = {}) {
  const origin = request.headers.get('Origin');
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
  const respond = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers });
  if (origin !== null && !origins.includes(origin)) return respond({ error: 'Origin not allowed' }, 403);
  if (origin !== null) headers.set('Access-Control-Allow-Origin', origin);
  const route = metadataRoute(target);
  if (!route) return respond({ error: 'Unknown metadata route' }, 404);
  if (method === 'OPTIONS') {
    if (!origin || request.headers.get('Access-Control-Request-Method') !== 'GET' || request.headers.get('Access-Control-Request-Headers')) return respond({ error: 'Preflight not allowed' }, 403);
    headers.set('Access-Control-Allow-Methods', 'GET');
    return respond(null, 204);
  }
  if (method !== 'GET') { headers.set('Allow', 'GET, OPTIONS'); return respond({ error: 'Method not allowed' }, 405); }
  const [, ttl, adapter] = route;
  // Versioned internal key; CORS and the per-delivery age are never stored here.
  const key = new Request(new URL(`/__metadata_cache_v2${target}`, request.url));
  let entry;
  if (cache && !target.startsWith('/api/homestream/')) {
    try {
      const cached = await cache.match(key);
      const value = cached && await cached.json();
      const age = now() - value?.validatedAt;
      if (value && Number.isSafeInteger(value.validatedAt) && age >= 0 && age < ttl * 1000 && value.data != null) entry = value;
    } catch { /* Cache failure is a miss, never an availability dependency. */ }
  }
  try {
    if (!entry) {
      const data = await adapter(target, { fetcher, signal: request.signal, now, diagnostic, catalog, gatewayOrigin });
      if (data == null) throw Error('metadata-unavailable');
      entry = { validatedAt: now(), data };
      if (cache && ctx && !target.startsWith('/api/homestream/')) {
        const stored = new Response(JSON.stringify(entry), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } });
        try { ctx.waitUntil(Promise.resolve().then(() => cache.put(key, stored)).catch(() => {})); } catch { /* Correct without cache. */ }
      }
    }
    if (target.startsWith('/api/sync/plays/')) {
      const residence = now() - entry.data.checkedAt;
      const total = Number.isSafeInteger(entry.data.ageMs) && entry.data.ageMs >= 0 && Number.isSafeInteger(residence) && residence >= 0 ? entry.data.ageMs + residence : null;
      const ageMs = Number.isSafeInteger(total) && total >= 0 ? total : null;
      return respond({ ...entry.data, ageMs });
    }
    return respond(entry.data);
  } catch (error) {
    const timeout = error?.name === 'TimeoutError';
    try { diagnostic({ stage: 'adapter', failure: timeout ? 'timeout' : 'normalization-or-upstream' }); } catch {}
    return respond({ error: timeout ? 'Metadata service timed out. Retry shortly; manual audio controls remain available.' : 'Metadata is temporarily unavailable. Retry shortly; manual audio controls remain available.' }, timeout ? 504 : 502);
  }
}
