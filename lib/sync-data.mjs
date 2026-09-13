import { readBackendJSON as readJSON, readBackendSnapshot } from './backend-json.mjs';
import { normalizeSchedule, normalizePlays } from './timing-normalize.mjs';
export { normalizeSchedule, normalizePlays } from './timing-normalize.mjs';
import { SUPPORTED_TEAMS } from './supported-teams.mjs';
const base = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
export async function syncData(pathname, {fetcher = fetch, signal, now = Date.now, diagnostic} = {}) {
  if (pathname === '/api/sync/teams') return SUPPORTED_TEAMS.map(team => ({...team}));
  const schedule = /^\/api\/sync\/schedule\/(\d{1,10})\/(20\d{2})$/.exec(pathname);
  const options = {fetcher, signal, now, diagnostic};
  if (schedule) return normalizeSchedule(await readJSON(`${base}/teams/${schedule[1]}/schedule?season=${schedule[2]}`, options), {teamId:schedule[1],season:Number(schedule[2])});
  const plays = /^\/api\/sync\/plays\/(\d{1,12})$/.exec(pathname);
  if (plays) {
    const snapshot = await readBackendSnapshot(`${base}/summary?event=${plays[1]}`, options);
    return normalizePlays(snapshot.data, now(), {eventId:plays[1],ageMs:snapshot.ageMs,receivedAt:snapshot.receivedAt});
  }
  return null;
}
