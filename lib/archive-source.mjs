import { parseEvents, rowCounts, rejectedRows, idOK, labelOK } from './duke-source.mjs';
export const sources = {
  duke: 'https://goduke.com/',
  vt: 'https://hokiesports.com/virginia-tech-sports-network',
  miami: 'https://miamihurricanes.com/miami-hurricanes-football-radio-affiliates/'
};
export function safeReplayURL(value, school, replayRules = {}) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return null;
    return (replayRules[school] || []).some(rule => u.origin === rule.origin && u.pathname.startsWith(rule.pathPrefix) && new RegExp(rule.filenamePattern).test(u.pathname.slice(rule.pathPrefix.length))) ? u.href : null;
  } catch { return null; }
}
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// Known empty forms: absent, null, blank string, empty object/array (an empty element).
const blank = value => value === undefined || value === null || (typeof value === 'string' && !value.trim()) || (plain(value) && !Object.keys(value).length) || (Array.isArray(value) && !value.length);
function strictVT(data, now, replayRules, counts, review) {
  if (!plain(data?.events) || !data.sports.sport.every(plain)) throw Error('Unexpected archive format');
  const sports = new Map(data.sports.sport.map(s => [String(s.id), s]));
  const rows = [];
  // At least one recognized section must be present; a missing or renamed section or event
  // container is structural, never an empty success. Empty forms count only inside one.
  const recognized = ['previous_ev', 'archived_ev'].filter(name => data.events[name] !== undefined);
  if (!recognized.length) counts.structural++;
  for (const name of recognized) {
    const section = data.events[name];
    if (blank(section)) continue;
    if (!plain(section) || !Object.hasOwn(section, 'event')) { counts.structural++; continue; }
    const value = section.event;
    if (blank(value)) continue;
    const list = Array.isArray(value) ? value : [value];
    if (!list.every(plain)) { counts.structural++; continue; }
    rows.push(...list);
  }
  const items = new Map();
  for (const e of rows) {
    counts.rows++;
    const addresses = [e.archive_url, e.recorded_url].filter(value => !blank(value));
    if (!addresses.length) { counts.unrecorded++; continue; }
    const sport = sports.get(String(e.sport_id));
    const start = Number(e.start_timestamp) * 1000;
    const id = typeof e.id === 'string' || Number.isSafeInteger(e.id) ? String(e.id) : '';
    const opponent = typeof e.opponent === 'string' ? e.opponent.trim() : '';
    const label = typeof sport?.name === 'string' ? sport.name.trim() : '';
    // The future exclusion requires a valid start; VT has no sport allowlist, so a missing
    // sport-table mapping is malformed rather than unsupported.
    if (!/^\d{1,12}$/.test(String(e.start_timestamp ?? '')) || !(start > 0)) { counts.malformed++; continue; }
    if (start >= now) { counts.future++; continue; }
    if (!sport || !addresses.every(value => typeof value === 'string') || !idOK(id) || !labelOK(opponent) || !labelOK(label)) { counts.malformed++; continue; }
    // Every advertised address must pass; a rejected one never falls back to the other field.
    const urls = addresses.map(value => safeReplayURL(value, 'vt', replayRules));
    if (review && urls.every(url => !url)) { review.push({ id, row: e, addresses }); continue; }
    if (urls.some(url => !url)) { counts.policyRejected++; continue; }
    const item = { id, opponent, sport: label, start: new Date(start).toISOString(), url: urls[0], kind: sport.is_show === '1' ? 'Show' : 'Game recording' };
    const prior = items.get(id);
    if (!prior) { items.set(id, item); counts.accepted++; }
    else if (JSON.stringify(prior) === JSON.stringify(item)) counts.duplicateIdentical++;
    else counts.duplicateConflict++;
  }
  if (rejectedRows(counts)) throw Error('Archive rows rejected');
  return [...items.values()].sort((a,b) => b.start.localeCompare(a.start));
}
// `strict` is for the scheduled archive refresh only (see parseEvents); defaults are unchanged.
export function normalizeVT(data, now = Date.now(), replayRules = {}, {strict = false, counts = rowCounts(), review} = {}) {
  if (!Array.isArray(data?.sports?.sport) || !data?.events) throw Error('Unexpected archive format');
  if (strict) return strictVT(data, now, replayRules, counts, review);
  const sports = new Map(data.sports.sport.map(s => [String(s.id), s]));
  const array = value => Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  const events = [...array(data.events.previous_ev?.event), ...array(data.events.archived_ev?.event)];
  const items = events.flatMap(e => {
    const sport = sports.get(String(e.sport_id));
    const url = safeReplayURL(e.archive_url || e.recorded_url, 'vt', replayRules);
    const start = Number(e.start_timestamp) * 1000;
    if (!sport || !url || !e.id || !Number.isFinite(start) || start <= 0 || start >= now || !e.opponent) return [];
    return [{ id: String(e.id), opponent: String(e.opponent), sport: sport.name, start: new Date(start).toISOString(), url, kind: sport.is_show === '1' ? 'Show' : 'Game recording' }];
  });
  return [...new Map(items.map(e => [e.id, e])).values()].sort((a,b) => b.start.localeCompare(a.start));
}
export async function readSource(url, fetcher = fetch, {timeoutMs=20000}={}) {
  const address = new URL(url);
  if (address.protocol !== 'https:' || address.username || address.password || address.port || address.hash) throw Error('Invalid source address');
  const controller=new AbortController();
  let reader;
  let rejectDeadline;
  const deadline=new Promise((_,reject)=>{rejectDeadline=reject;});
  const timer=setTimeout(()=>{controller.abort();reader?.cancel().catch(()=>{});rejectDeadline(new DOMException('Source deadline','TimeoutError'));},timeoutMs);
  try {
    const response = await Promise.race([fetcher(address.href, { signal: controller.signal, redirect: 'manual' }),deadline]);
    if (!response.ok || Number(response.headers.get('content-length')) > 5_000_000) { await response.body?.cancel(); throw Error('Source unavailable'); }
    reader = response.body?.getReader();
    if (!reader) throw Error('Source unavailable');
    let bytes=0, text=''; const decoder=new TextDecoder();
    for (;;) { const {done,value}=await Promise.race([reader.read(),deadline]); if(controller.signal.aborted) throw new DOMException('Source deadline','TimeoutError');if(done) break; bytes+=value.byteLength; if(bytes>5_000_000) throw Error('Archive too large'); text+=decoder.decode(value,{stream:true}); }
    return text+decoder.decode();
  } catch (error) { await reader?.cancel().catch(()=>{}); throw error; }
  finally {clearTimeout(timer);reader?.releaseLock();}
}
// Reviewed source exclusions (issue #4, ARCH-009 amendment). On 2026-10-07 the strict probe found
// exactly one row per school whose two advertised addresses sit on the approved HTTPS origin and
// path but fail only the filename rule; neither row was in retained history, and failing the whole
// school would have frozen every approved recording. Each SHA-256 covers the full row (Duke: exact
// inner <event> XML; VT: JSON.stringify of the key-sorted original event object, UTF-8), so any
// change to the row, its addresses or its shape no longer matches. The URL policy is unchanged and
// these rows are never published. Changing this list requires a new reviewed exception.
const REVIEWED_SOURCE_EXCLUSIONS = Object.freeze({
  duke: Object.freeze(['4de8abb1a714a80581c4fa0ed71476610114be16da0af197a20c88429913049b']),
  vt: Object.freeze(['f546311d8bca1ce990013d284bbe1ce70be73b453faa54782139c09997f427bb'])
});
const sortKeys = value => Array.isArray(value) ? value.map(sortKeys) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])])) : value;
async function rowDigest(school, row) {
  const text = school === 'vt' ? JSON.stringify(sortKeys(row)) : row;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
// Rejected by the filename rule alone: a clean HTTPS address on an approved origin and path prefix
// naming a plain .mp3 file in that directory.
function filenameOnlyRejection(value, rules) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return false;
    return rules.some(rule => {
      const name = u.pathname.slice(rule.pathPrefix.length);
      return u.origin === rule.origin && u.pathname.startsWith(rule.pathPrefix) && /^[^/]+\.mp3$/i.test(name) && !new RegExp(rule.filenamePattern).test(name);
    });
  } catch { return false; }
}
// Decides rows the strict parser deferred because every advertised address was rejected. Excluded
// only if the full-row digest is reviewed, the ID is not in retained history, both addresses are
// advertised and each is a filename-only rejection. Anything else fails the school as before, and
// an excluded-only result is not published as a fresh empty list. `digests` exists for synthetic
// tests; fetchArchive always uses the fixed reviewed list.
export async function excludeReviewedRows(school, items, review, {counts, retainedIds, rules = [], digests = REVIEWED_SOURCE_EXCLUSIONS[school] || []}) {
  const retained = new Set(Array.isArray(retainedIds) ? retainedIds : []), accepted = new Set(items.map(item => item.id)), seen = new Map();
  for (const {id, row, addresses} of review) {
    const digest = await rowDigest(school, row);
    if (accepted.has(id) || (seen.has(id) && seen.get(id) !== digest)) { counts.duplicateConflict++; continue; }
    if (seen.has(id)) { counts.duplicateIdentical++; continue; }
    seen.set(id, digest);
    if (!Array.isArray(retainedIds) || retained.has(id) || !digests.includes(digest) || addresses.length !== 2 || !addresses.every(value => filenameOnlyRejection(value, rules))) { counts.policyRejected++; continue; }
    counts.sourceExcluded++;
  }
  if (counts.sourceExcluded && !items.length) counts.excludedOnly++;
  if (rejectedRows(counts)) throw Error('Archive rows rejected');
  return items;
}
// Only `strict`, `counts` and `retainedIds` are honored; callers cannot supply exclusions.
export async function fetchArchive(school, fetcher = fetch, config = {}, now = Date.now(), {strict = false, counts = rowCounts(), retainedIds} = {}) {
  const review = strict ? [] : undefined, options = {strict, counts, review};
  const finish = items => strict ? excludeReviewedRows(school, items, review, {counts, retainedIds, rules: config.replayRules?.[school] || []}) : items;
  if (school === 'vt') return finish(normalizeVT(JSON.parse(await readSource(config.vtFeed, fetcher)).data,now,config.replayRules,options));
  if (school !== 'duke') throw Error('Unsupported archive');
  const player = new URL(config.dukePlayer);
  const html = await readSource(player.href, fetcher);
  const raw = html.match(/\bprevious\s*:\s*"([^"]+)"/)?.[1];
  if (!raw) throw Error('Archive feed missing');
  const feed = new URL(raw);
  if (feed.origin !== player.origin || feed.pathname !== config.dukeFeedPath || feed.username || feed.password || feed.hash) throw Error('Unexpected feed');
  return finish(parseEvents(await readSource(feed.href, fetcher), 'archive',now,value=>safeReplayURL(value,'duke',config.replayRules),options).filter(e => Date.parse(e.start) < now).map(({id,opponent,sport,start,url}) => ({id,opponent,sport,start,url,kind:'Game recording'})));
}
export async function createCatalog(fetcher = fetch, config = {}, now = Date.now()) {
  const schools = { miami: { source: sources.miami, status: 'external', items: [] } };
  await Promise.all(['duke', 'vt'].map(async school => {
    try { schools[school] = { source: sources[school], status: 'ready', items: await fetchArchive(school, fetcher,config,now) }; }
    catch { schools[school] = { source: sources[school], status: 'unavailable', items: [] }; }
  }));
  return { checkedAt: new Date(now).toISOString(), schools };
}
