import { parseEvents } from './duke-source.mjs';
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
export function normalizeVT(data, now = Date.now(), replayRules = {}) {
  if (!Array.isArray(data?.sports?.sport) || !data?.events) throw Error('Unexpected archive format');
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
export async function fetchArchive(school, fetcher = fetch, config = {}, now = Date.now()) {
  if (school === 'vt') return normalizeVT(JSON.parse(await readSource(config.vtFeed, fetcher)).data,now,config.replayRules);
  if (school !== 'duke') throw Error('Unsupported archive');
  const player = new URL(config.dukePlayer);
  const html = await readSource(player.href, fetcher);
  const raw = html.match(/\bprevious\s*:\s*"([^"]+)"/)?.[1];
  if (!raw) throw Error('Archive feed missing');
  const feed = new URL(raw);
  if (feed.origin !== player.origin || feed.pathname !== config.dukeFeedPath || feed.username || feed.password || feed.hash) throw Error('Unexpected feed');
  return parseEvents(await readSource(feed.href, fetcher), 'archive',now,value=>safeReplayURL(value,'duke',config.replayRules)).filter(e => Date.parse(e.start) < now).map(({id,opponent,sport,start,url}) => ({id,opponent,sport,start,url,kind:'Game recording'}));
}
export async function createCatalog(fetcher = fetch, config = {}, now = Date.now()) {
  const schools = { miami: { source: sources.miami, status: 'external', items: [] } };
  await Promise.all(['duke', 'vt'].map(async school => {
    try { schools[school] = { source: sources[school], status: 'ready', items: await fetchArchive(school, fetcher,config,now) }; }
    catch { schools[school] = { source: sources[school], status: 'unavailable', items: [] }; }
  }));
  return { checkedAt: new Date(now).toISOString(), schools };
}
