import { metadataGateway } from '../lib/metadata-gateway.mjs';
export default {
  async fetch(request, env, ctx) {
    let origins;
    try {
      origins = JSON.parse(env.ALLOWED_ORIGINS);
      if (!Array.isArray(origins) || !origins.every(value => typeof value === 'string' && new URL(value).origin === value && value !== 'null')) throw Error();
    } catch {
      return Response.json({ error: 'Metadata service configuration unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    let cache;
    try { cache = caches.default; } catch { /* Optional optimization. */ }
    return metadataGateway(request, { origins, cache, ctx });
  }
};
