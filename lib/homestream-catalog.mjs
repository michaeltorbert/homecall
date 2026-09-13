import { HOMESTREAM_API, normalizeTeams, normalizeGames } from '../src/homestream.js';
import { readBackendJSON as readJSON } from './backend-json.mjs';
// Fixed upstream routes, no caller-supplied hosts, credentials, or stream proxying.
export async function homestreamCatalog(pathname, { fetcher = fetch, signal } = {}) {
  if (pathname === '/api/homestream/teams') return normalizeTeams(await readJSON(`${HOMESTREAM_API}/teams`, { fetcher, signal }));
  const match = /^\/api\/homestream\/games\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(pathname);
  if (!match) return null;
  return normalizeGames(await readJSON(`${HOMESTREAM_API}/games/teams/${match[1]}?game_type=football`, { fetcher, signal }), match[1]);
}
