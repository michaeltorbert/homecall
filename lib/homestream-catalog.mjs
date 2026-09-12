import { HOMESTREAM_API, normalizeTeams, normalizeGames, readJSON } from '../src/homestream.js';
// Fixed upstream routes, no caller-supplied hosts, credentials, or stream proxying.
export async function homestreamCatalog(pathname, { fetcher = fetch } = {}) {
  if (pathname === '/api/homestream/teams') return normalizeTeams(await readJSON(`${HOMESTREAM_API}/teams`, { fetcher }));
  const match = /^\/api\/homestream\/games\/([a-f0-9-]{36})$/.exec(pathname);
  if (!match) return null;
  return normalizeGames(await readJSON(`${HOMESTREAM_API}/games/teams/${match[1]}?game_type=football`, { fetcher }), match[1]);
}
