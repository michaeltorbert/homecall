import { readBackendJSON } from './backend-json.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const resolvedCaches = new WeakMap();
const ID = /^[A-Za-z0-9_-]{1,60}$/;
export function normalizeTeams(data) {
  if (data?.success !== true || !Array.isArray(data.teams)) throw Error('catalog-invalid');
  return data.teams.filter(t => UUID.test(t?.team_id) && typeof t.school_name === 'string').map(t => ({id:t.team_id,name:t.school_name.trim().slice(0,200)}));
}
export function normalizeGames(data, teamId, catalog) {
  if (data?.success !== true || !Array.isArray(data.games)) throw Error('catalog-invalid');
  return data.games.filter(g => g?.game_type === 'football' && ID.test(g.game_id) && (g.home_team_id === teamId || g.away_team_id === teamId)).map(g => {
    const home = g.home_team_id === teamId;
    const start = g.timezone === 'UTC' && /^\d{4}-\d{2}-\d{2}$/.test(g.date) && /^\d{2}:\d{2}$/.test(g.time) ? Date.parse(`${g.date}T${g.time}:00Z`) : NaN;
    let target = null;
    try {
      const u = new URL(home ? g.home_cloudfront_url : g.away_cloudfront_url);
      if (u.protocol === 'https:' && !u.username && !u.password && !u.hash && u.pathname.endsWith('.m3u8') && catalog.discovery.mediaOrigins.includes(u.origin)) target = {url:u.href,allowedOrigins:catalog.discovery.mediaOrigins,kind:'hls'};
    } catch {}
    return {id:g.game_id,opponent:String((home ? g.away_team_school_name : g.home_team_school_name) || (home ? g.away_team : g.home_team) || 'Opponent pending').slice(0,200),start:Number.isFinite(start)?start:null,date:typeof g.date==='string'?g.date:'',target};
  }).sort((a,b)=>(a.start??Infinity)-(b.start??Infinity));
}
export async function privateGames(teamId,{catalog,fetcher=fetch,signal,now=Date.now}={}) {
  if (!UUID.test(teamId) || !catalog?.discovery?.homestreamBase) throw Error('catalog-unavailable');
  let cache=resolvedCaches.get(fetcher);
  if(!cache){cache=new Map();resolvedCaches.set(fetcher,cache);}
  const key=JSON.stringify([catalog.version,catalog.discovery,teamId]);
  const existing=cache.get(key),timestamp=now();
  if(existing && timestamp>=existing.checkedAt && timestamp-existing.checkedAt<15000)return existing.games;
  const games=normalizeGames(await readBackendJSON(`${catalog.discovery.homestreamBase}/games/teams/${teamId}?game_type=football`,{fetcher,signal}),teamId,catalog);
  // Short, bounded read-through only. No stale-on-error or KV writes, and never
  // retain a signed URL whose provider expiration may precede this cache TTL.
  if(games.every(g=>!g.target||!new URL(g.target.url).search)){
    if(cache.size>=16)cache.delete(cache.keys().next().value);
    cache.set(key,{checkedAt:timestamp,games});
  }
  return games;
}
export async function homestreamCatalog(pathname,{catalog,gatewayOrigin,fetcher=fetch,signal}={}) {
  if (!catalog?.discovery?.homestreamBase) throw Error('catalog-unavailable');
  if (pathname === '/api/homestream/teams') return normalizeTeams(await readBackendJSON(`${catalog.discovery.homestreamBase}/teams`,{fetcher,signal}));
  const match = /^\/api\/homestream\/games\/([^/]+)$/.exec(pathname);
  if (!match || !UUID.test(match[1])) return null;
  return (await privateGames(match[1],{catalog,fetcher,signal})).map(({target,...game})=>({...game,url:target?new URL(`/media/game/${match[1]}/${game.id}`,gatewayOrigin).href:null}));
}
