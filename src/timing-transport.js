import { readBackendJSON } from '../lib/backend-json.mjs';
import { normalizeSchedule, normalizePlays } from '../lib/timing-normalize.mjs';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
// Explicit per-session alternative, never an automatic retry after a gateway
// error. Only these public CORS routes are eligible; no caller-supplied URLs.
export async function browserTiming(path, { signal, fetcher = fetch, now = Date.now } = {}) {
  const schedule = /^sync\/schedule\/(\d{1,10})\/(20\d{2})$/.exec(path);
  if (schedule) return normalizeSchedule(await readBackendJSON(`${ESPN}/teams/${schedule[1]}/schedule?season=${schedule[2]}`, {signal, fetcher}), {teamId:schedule[1],season:Number(schedule[2])});
  const plays = /^sync\/plays\/(\d{1,12})$/.exec(path);
  if (!plays) throw Error('timing-route-unavailable');
  const data = await readBackendJSON(`${ESPN}/summary?event=${plays[1]}`, {signal, fetcher});
  // Even a successful CORS read does not establish upstream age. This source
  // displays anchors but cannot enable estimated clock seeking in this release.
  return normalizePlays(data, now(), {eventId:plays[1],ageMs:null});
}
