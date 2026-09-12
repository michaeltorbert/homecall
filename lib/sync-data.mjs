import { readJSON } from '../src/homestream.js';
import { clockSeconds } from '../src/sync-mapping.js';
const base = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
export function normalizeSchedule(data) {
  if (!Array.isArray(data?.events)) throw Error('schedule-unavailable');
  return data.events.flatMap(e => {
    const teams = e.competitions?.[0]?.competitors?.map(c => c.team?.location);
    return /^\d+$/.test(e.id) && Number.isFinite(Date.parse(e.date)) && teams?.length === 2 && teams.every(t => typeof t === 'string') ? [{id:e.id,start:Date.parse(e.date),teams}] : [];
  });
}
export function normalizePlays(data, now = Date.now()) {
  if (!data?.header || !data.drives) throw Error('plays-unavailable');
  const drives = [...(data.drives.previous || []), data.drives.current || {}];
  const plays = new Map();
  for (const drive of drives) for (const p of drive.plays || []) {
    const utc = Date.parse(p.wallclock), quarter = p.period?.number, clock = p.clock?.displayValue;
    if (typeof p.id === 'string' && Number.isFinite(utc) && Number.isInteger(quarter) && quarter > 0 && Number.isFinite(clockSeconds(clock)))
      plays.set(p.id,{id:p.id,utc,quarter,clock,text:typeof p.text === 'string' ? p.text : 'Play'});
  }
  // Play IDs preserve provider order, unlike corrected wallclock values.
  const ordered = [...plays.values()].sort((a,b) => a.id.localeCompare(b.id, 'en', {numeric:true}));
  return { checkedAt: now, plays: ordered, conflict: ordered.some((p,i) => i > 0 && p.utc < ordered[i-1].utc) };
}
export async function syncData(pathname, {fetcher = fetch} = {}) {
  if (pathname === '/api/sync/teams') {
    const data = await readJSON(`${base}/teams?limit=1000`, {fetcher});
    const teams = data?.sports?.[0]?.leagues?.[0]?.teams;
    if (!Array.isArray(teams)) throw Error('teams-unavailable');
    return teams.flatMap(({team:t}) => /^\d+$/.test(t?.id) && typeof t.location === 'string' ? [{id:t.id,name:t.location}] : []);
  }
  const schedule = /^\/api\/sync\/schedule\/(\d{1,10})\/(20\d{2})$/.exec(pathname);
  if (schedule) return normalizeSchedule(await readJSON(`${base}/teams/${schedule[1]}/schedule?season=${schedule[2]}`, {fetcher}));
  const plays = /^\/api\/sync\/plays\/(\d{1,12})$/.exec(pathname);
  if (plays) return normalizePlays(await readJSON(`${base}/summary?event=${plays[1]}`, {fetcher}));
  return null;
}
