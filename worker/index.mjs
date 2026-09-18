import { streamGateway } from '../lib/stream-gateway.mjs';
import { readPrivateCatalog, refreshPrivateCatalog } from '../lib/private-catalog.mjs';
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
    const target = request.url.replace(/^https?:\/\/[^/]+/, '');
    if (target.startsWith('/media/') || target.startsWith('/api/catalog/')) return streamGateway(request, env, {origins, target});
    let catalog;
    if (target.startsWith('/api/homestream/') && !target.includes('?') && !target.includes('%')) {
      try { catalog = await readPrivateCatalog(env); } catch { /* Router still validates method/path before failing closed. */ }
    }
    let cache;
    try { cache = caches.default; } catch { /* Optional optimization. */ }
    const routeFamily = new URL(request.url).pathname.split('/').slice(1, 4).join('/');
    const allowedFamilies = ['api/sync/teams', 'api/sync/schedule', 'api/sync/plays', 'api/homestream/teams', 'api/homestream/games'];
    const correlationId = crypto.randomUUID();
    const diagnostic = detail => console.warn(JSON.stringify({ event: 'metadata-failure', version: 'timing-diagnostics-v1', correlationId, route: allowedFamilies.includes(routeFamily) ? routeFamily : 'unknown', ...detail }));
    return metadataGateway(request, { origins, cache, ctx, diagnostic, catalog });
  },
  async scheduled(event, env, ctx) {
    if (env.ENABLE_CATALOG_REFRESH === "true") ctx.waitUntil(refreshPrivateCatalog(env));
  }
};
