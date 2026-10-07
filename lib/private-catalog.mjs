import { fetchArchive, safeReplayURL, sources } from './archive-source.mjs';
import { rowCounts, rejectedRows, labelOK } from './duke-source.mjs';
const MAX_BYTES = 5_000_000;
const statuses = new Set(['ready', 'external', 'unavailable', 'stale']);
const idOK = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const isoOK = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
function https(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.hash) throw Error('Invalid catalog address');
  return u;
}
function target(value) {
  const u = https(value.url);
  if (value.kind !== 'audio' || !Array.isArray(value.allowedOrigins) || !value.allowedOrigins.length || value.allowedOrigins.length > 16 || !value.allowedOrigins.every(o => https(o).origin === o) || !value.allowedOrigins.includes(u.origin)) throw Error('Invalid catalog target');
}
export function validatePrivateCatalog(catalog) {
  if (!catalog || catalog.schemaVersion !== 1 || typeof catalog.version !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(catalog.version) || !isoOK(catalog.updatedAt) || !catalog.live || !catalog.archive?.schools || !isoOK(catalog.archive.checkedAt)) throw Error('Invalid private catalog');
  if (Object.keys(catalog.live).length > 200 || Object.keys(catalog.archive.schools).length > 20) throw Error('Catalog exceeds limits');
  for (const [id, value] of Object.entries(catalog.live)) { if (!idOK(id)) throw Error('Invalid source ID'); target(value); }
  for (const [school, data] of Object.entries(catalog.archive.schools)) {
    if (!Object.hasOwn(sources, school) || !idOK(school) || !statuses.has(data.status) || !Array.isArray(data.items) || data.items.length > 5000 || (data.checkedAt && !isoOK(data.checkedAt))) throw Error('Invalid archive catalog');
    https(data.source);
    const ids = new Set();
    for (const item of data.items) {
      if (!idOK(item.id) || ids.has(item.id) || !isoOK(item.start) || !['opponent','sport','kind'].every(k => typeof item[k] === 'string' && item[k].length <= 500) || !safeReplayURL(item.url, school, catalog.archiveConfig?.replayRules)) throw Error('Invalid archive item');
      ids.add(item.id);
    }
  }
  if (catalog.discovery?.homestreamBase) https(catalog.discovery.homestreamBase);
  if (catalog.discovery?.mediaOrigins && (!Array.isArray(catalog.discovery.mediaOrigins) || catalog.discovery.mediaOrigins.length > 16 || !catalog.discovery.mediaOrigins.every(o => https(o).origin === o))) throw Error('Invalid discovery origins');
  const redirects = catalog.archiveConfig?.redirectOrigins;
  if (redirects !== undefined) {
    if (!redirects || typeof redirects !== 'object' || Array.isArray(redirects)) throw Error('Invalid archive redirect origins');
    for (const [school, origins] of Object.entries(redirects)) {
      if (!Object.hasOwn(sources, school) || !Array.isArray(origins) || origins.length > 16 || !origins.every(o => https(o).origin === o)) throw Error('Invalid archive redirect origins');
    }
  }
  return catalog;
}
// Some replay hosts answer a cold request with a redirect to a separately approved origin.
export function archiveOrigins(catalog, school, url) {
  const configured = catalog.archiveConfig?.redirectOrigins;
  return [...new Set([new URL(url).origin, ...(configured && Object.hasOwn(configured, school) ? configured[school] : [])])];
}
// KV is still read on every request; only an identical document skips parsing and
// validation again. Callers treat the returned catalog as shared and never mutate it.
const parsed = new WeakMap();
export async function readPrivateCatalog(env) {
  if (!env.STREAM_CATALOG) throw Error('Private catalog unavailable');
  const raw = await env.STREAM_CATALOG.get('catalog');
  if (typeof raw !== 'string' || raw.length > MAX_BYTES || new TextEncoder().encode(raw).length > MAX_BYTES) throw Error('Private catalog unavailable');
  const previous = parsed.get(env.STREAM_CATALOG);
  if (previous && previous.raw === raw) return previous.catalog;
  let catalog;
  try { catalog = validatePrivateCatalog(JSON.parse(raw)); } catch { throw Error('Private catalog invalid'); }
  parsed.set(env.STREAM_CATALOG, { raw, catalog });
  return catalog;
}
export function publicLiveCatalog(catalog, gatewayOrigin) {
  return Object.keys(catalog.live).map(id => ({ id, url: new URL(`/media/live/${encodeURIComponent(id)}`, gatewayOrigin).href }));
}
export function publicArchiveCatalog(catalog, gatewayOrigin) {
  return { checkedAt: catalog.archive.checkedAt, schools: Object.fromEntries(Object.entries(catalog.archive.schools).map(([school,data]) => [school, {
    source: sources[school], status: data.status, ...(data.checkedAt ? {checkedAt:data.checkedAt} : {}),
    items: data.items.map(({id,opponent,sport,start,kind}) => ({id,opponent,sport,start,kind,url:new URL(`/media/archive/${school}/${id}`,gatewayOrigin).href}))
  }])) };
}
export function findArchiveTarget(catalog, school, id) {
  if (!Object.hasOwn(catalog.archive.schools, school)) return null;
  const item = catalog.archive.schools[school].items.find(item => item.id === id);
  if (!item) return null;
  return {url:item.url,allowedOrigins:archiveOrigins(catalog,school,item.url),kind:'audio'};
}
// A fresh candidate is held to the stored rules plus client-compatible labels before it can
// replace a school's history. Stored-document acceptance itself is not tightened here.
function validateCandidate(items, school, replayRules) {
  if (!Array.isArray(items) || items.length > 5000) throw Error('Invalid archive candidate');
  const ids = new Set();
  for (const item of items) {
    if (!item || !idOK(item.id) || ids.has(item.id) || !isoOK(item.start) || !['opponent','sport','kind'].every(k => labelOK(item[k])) || !safeReplayURL(item.url, school, replayRules)) throw Error('Invalid archive candidate');
    ids.add(item.id);
  }
  return items;
}
// A legacy `ready` record without its own time inherits the old catalog's check time, which is
// evidence from that validated document. A future or missing time stays unknown; nothing is invented.
function previousRecord(record, catalog, now) {
  if (record.status !== 'ready' || record.checkedAt) return record;
  const inherited = Date.parse(catalog.archive.checkedAt);
  return inherited <= now ? {...record, checkedAt: catalog.archive.checkedAt} : record;
}
// Single configured schedule; overlap is NOT excluded. KV is eventually consistent and has no
// atomic lock/CAS, so overlapping runs or administrative writes are last-writer-wins on the whole
// document and can lose an update or regress a school's check time (characterized in tests).
// `stats`, when supplied, receives per-school numeric counts and a fixed outcome word only.
export async function refreshPrivateCatalog(env, {fetcher = fetch, now = Date.now(), stats} = {}) {
  const catalog = await readPrivateCatalog(env);
  const timestamp = new Date(now).toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const boundedFetch = (url, options = {}) => fetcher(url, {...options, signal: AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])])});
  try {
    const schools = {...catalog.archive.schools};
    let refreshed = false;
    await Promise.all(['duke','vt'].filter(school => schools[school]).map(async school => {
      const previous = previousRecord(schools[school], catalog, now);
      const counts = rowCounts();
      let stage = 'source';
      try {
        const items = await fetchArchive(school, boundedFetch, catalog.archiveConfig, now, {strict:true, counts, retainedIds:previous.items.map(item => item.id)});
        stage = 'candidate';
        validateCandidate(items, school, catalog.archiveConfig?.replayRules);
        schools[school] = {...previous,status:'ready',checkedAt:timestamp,items};
        refreshed = true;
        if (stats) stats[school] = {outcome:'refreshed', ...counts};
      } catch {
        // Successful history, even an empty one, is retained as stale with its original time.
        const history = previous.status === 'ready' || previous.status === 'stale';
        schools[school] = {...previous,status:history ? 'stale' : 'unavailable'};
        if (stats) stats[school] = {outcome:history ? 'retained' : 'unavailable', failure:rejectedRows(counts) ? 'rows' : stage, ...counts};
      }
    }));
    if (JSON.stringify(schools) === JSON.stringify(catalog.archive.schools)) return {changed:false};
    const next = {...catalog,updatedAt:timestamp,archive:{checkedAt:refreshed ? timestamp : catalog.archive.checkedAt,schools}};
    validatePrivateCatalog(next);
    const serialized = JSON.stringify(next);
    if (new TextEncoder().encode(serialized).length > MAX_BYTES) throw Error('Catalog exceeds limits');
    await env.STREAM_CATALOG.put('catalog', serialized);
    return {changed:true};
  } finally { clearTimeout(timer); }
}
