import { parseEvents } from './duke-source.mjs';
export const sources = {
  duke: 'https://duke.leanplayer.com/',
  vt: 'https://hokiesports.com/virginia-tech-sports-network',
  miami: 'https://miamihurricanes.com/miami-hurricanes-football-radio-affiliates/'
};
const vtFeed = 'https://us-central1-lyrical-amulet-150218.cloudfunctions.net/wmt-leanstream-proxy-v2/?id=9004&archive=true';
export function safeReplayURL(value, school) {
  const college = { duke: '35', vt: '9004' }[school];
  if (!college) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return null;
    const prefix = u.hostname === 's3.amazonaws.com' ? '/archive.leanplayer.com/gameday/' : u.hostname === 'ais-aod.leanstream.co' ? '/gameday/' : null;
    return prefix && u.pathname.startsWith(prefix) && new RegExp(`^\\d+_${college}_\\d+\\.mp3$`).test(u.pathname.slice(prefix.length)) ? u.href : null;
  } catch { return null; }
}
export function normalizeVT(data, now = Date.now()) {
  if (!Array.isArray(data?.sports?.sport) || !data?.events) throw Error('Unexpected archive format');
  const sports = new Map(data.sports.sport.map(s => [String(s.id), s]));
  const array = value => Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  const events = [...array(data.events.previous_ev?.event), ...array(data.events.archived_ev?.event)];
  const items = events.flatMap(e => {
    const sport = sports.get(String(e.sport_id));
    const url = safeReplayURL(e.archive_url || e.recorded_url, 'vt');
    const start = Number(e.start_timestamp) * 1000;
    if (!sport || !url || !e.id || !Number.isFinite(start) || start <= 0 || start >= now || !e.opponent) return [];
    return [{ id: String(e.id), opponent: String(e.opponent), sport: sport.name, start: new Date(start).toISOString(), url, kind: sport.is_show === '1' ? 'Show' : 'Game recording' }];
  });
  return [...new Map(items.map(e => [e.id, e])).values()].sort((a,b) => b.start.localeCompare(a.start));
}
async function read(url, fetcher) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw Error('Source unavailable');
  const text = await response.text();
  if (text.length > 5_000_000) throw Error('Archive too large');
  return text;
}
export async function fetchArchive(school, fetcher = fetch) {
  if (school === 'vt') return normalizeVT(JSON.parse(await read(vtFeed, fetcher)).data);
  if (school !== 'duke') throw Error('Unsupported archive');
  const html = await read(sources.duke, fetcher);
  const raw = html.match(/\bprevious\s*:\s*"([^"]+)"/)?.[1];
  if (!raw) throw Error('Archive feed missing');
  const feed = new URL(raw);
  if (feed.origin !== sources.duke.slice(0,-1) || feed.pathname !== '/uploads/xml/previous_events_college_35.xml' || feed.username || feed.password) throw Error('Unexpected feed');
  return parseEvents(await read(feed.href, fetcher), 'archive').filter(e => safeReplayURL(e.url, 'duke') && Date.parse(e.start) < Date.now()).map(({id,opponent,sport,start,url}) => ({id,opponent,sport,start,url,kind:'Game recording'}));
}
export async function createCatalog(fetcher = fetch) {
  const schools = { miami: { source: sources.miami, status: 'external', items: [] } };
  await Promise.all(['duke', 'vt'].map(async school => {
    try { schools[school] = { source: sources[school], status: 'ready', items: await fetchArchive(school, fetcher) }; }
    catch { schools[school] = { source: sources[school], status: 'unavailable', items: [] }; }
  }));
  return { checkedAt: new Date().toISOString(), schools };
}
