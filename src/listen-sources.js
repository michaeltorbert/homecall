import { teams, catalogTeams, getSources, gameSourceId } from './teams.js';
// Listen's source resolver. Pure: it reads configuration and the catalog's published state, never
// plays audio, and never invents a feed, a network fallback or an official link.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHECKING = new Set(['idle', 'loading', 'checking']);

// Every radio team plus every school the catalog lists, joined only by explicit catalog ID. A listed
// school without configuration stays reachable under catalog:<id> with its catalog name.
export function listenTeams(catalogList = []) {
  const list = new Map(Object.entries(teams).map(([key, team]) => [key, { key, name: team.name, catalogId: team.catalogId ?? null, radio: !team.discovery }]));
  const known = new Map([...Object.entries(teams), ...Object.entries(catalogTeams)].filter(([, team]) => team.catalogId).map(([key, team]) => [team.catalogId, key]));
  for (const entry of Array.isArray(catalogList) ? catalogList : []) {
    if (typeof entry?.id !== 'string' || !UUID.test(entry.id) || typeof entry.name !== 'string' || !entry.name.trim()) continue;
    const key = known.get(entry.id) ?? `catalog:${entry.id}`;
    if (list.has(key)) continue;
    list.set(key, { key, name: catalogTeams[key]?.name ?? entry.name.trim().slice(0, 60), catalogId: entry.id, radio: false });
  }
  return list;
}
// Concise visible picker text; the complete description stays in the option title.
export function sourceLabel(source) {
  if (source.kind === 'game') return 'Game feed';
  if (source.kind === 'network') return 'Network';
  if (source.kind === 'network-backup') return 'Network backup';
  return `${source.label.split(' · ')[0]} backup`;
}
function gameCandidate(team, game) {
  const configured = teams[team.key];
  return { sourceId: gameSourceId(team.key), kind: 'game', hls: true, url: game.url, game, label: 'Game feed',
    description: `${team.name} vs ${game.opponent} · published game feed`, title: `${team.name} vs ${game.opponent}`,
    station: configured?.discovery ? configured.station : `${team.name} · Game feed`, official: configured?.official ?? null };
}
function radioCandidate(source) {
  return { sourceId: source.sourceId, kind: source.kind ?? 'network', hls: false, url: source.url, label: sourceLabel(source), description: source.label,
    title: source.station, station: source.station, official: source.official, note: source.note ?? null };
}
// Candidate order for one team and game: the playable game feed, then the existing network, its backup
// connection and affiliates. Timestamp capability never changes the order. Duplicates keep their first rank.
export function resolveSources(team, { status = 'idle', game = null } = {}) {
  const gameState = !team?.catalogId ? 'none' : CHECKING.has(status) ? 'checking' : status === 'ready' && game?.url ? 'ready' : 'unavailable';
  const all = [...(gameState === 'ready' ? [gameCandidate(team, game)] : []), ...(team?.radio ? getSources(team.key).map(radioCandidate) : [])];
  const ids = new Set(), urls = new Set(), candidates = [];
  for (const candidate of all) {
    if (ids.has(candidate.sourceId) || (candidate.url && urls.has(candidate.url))) continue;
    ids.add(candidate.sourceId); if (candidate.url) urls.add(candidate.url); candidates.push(candidate);
  }
  const state = gameState === 'checking' ? 'checking' : candidates.length ? 'resolved' : 'unavailable';
  return { state, game: gameState, gameSourceId: team?.catalogId ? gameSourceId(team.key) : null, candidates };
}
// The configured official player for exhaustion and the menu, or null when none exists.
export const officialLink = (team, candidate = null) => candidate?.official ?? teams[team?.key]?.official ?? null;
