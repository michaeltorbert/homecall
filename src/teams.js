import { relayURL, configuredGatewayOrigin } from './gateway.js';
// catalogId is the explicit Homestream team identity (lib/supported-teams.mjs); names never decide it.
export const teams = {
  gt: { name: 'Georgia Tech', nickname: 'Yellow Jackets', sourceId: 'gt-homestream', station: 'Georgia Tech · Homestream', discovery: 'homestream', catalogId: '410422f0-663f-4e3d-82e2-787d954ae29d', official: 'https://ramblinwreck.com/radio', color: '#d9bc7a' },
  duke: { name: 'Duke', nickname: 'Blue Devils', sourceId: 'duke-leanstream', station: 'Duke Sports Network', kind: 'network', catalogId: '2903e5f6-960e-4954-a3ec-f7754e78660f', official: 'https://duke.leanplayer.com/', color: '#8daeff' },
  miami: { name: 'Miami', nickname: 'Hurricanes', sourceId: 'miami-wqam', station: '104.3 WQAM', kind: 'network', official: 'https://www.audacy.com/stations/wqam', color: '#ffaf70' },
  // Virginia Tech has no catalog identity, so it can never resolve to Virginia's game feeds.
  vt: { name: 'Virginia Tech', nickname: 'Hokies', sourceId: 'vt-leanstream', station: 'Virginia Tech Sports Network', kind: 'network', official: 'https://hokiesports.com/virginia-tech-sports-network', color: '#ed9dab' }
};
// Catalog-only schools: reachable through their published game feeds, with no network fallback and no
// configured official player link. Other schools the catalog lists are reachable by their catalog ID.
export const catalogTeams = {
  auburn: { name: 'Auburn', catalogId: 'ffacbef1-e8a5-4872-9401-eff97cdf2c9c' },
  uva: { name: 'Virginia', catalogId: 'b3c33c46-a9e4-4e3b-9d5a-4fefb625f14c' },
};

// These affiliates carried Duke postgame in audio samples on 2026-09-12.
// When the network fails, Listen falls back automatically through these existing backups in this order,
// after the network's own backup connection. Availability and programming can change, so an affiliate
// fallback keeps its coverage caution and a manual Source override stays available.
teams.duke.backups = [
  { sourceId: 'duke-varsity', kind: 'network-backup', label: 'Duke network · backup connection', station: 'Duke Sports Network · backup', official: 'https://thevarsitynetwork.com/feed/source/oas-1693', note: 'An alternate connection to the Duke network used by Varsity. It shares the same broadcast provider as the primary.' },
  { sourceId: 'duke-wsjs', kind: 'affiliate', label: 'WSJS · affiliate backup', station: 'WSJS · Duke affiliate', official: 'https://broadcast.truthnetwork.com/player-wsjs.lasso?p=wsjs' },
  { sourceId: 'duke-wccg', kind: 'affiliate', label: 'WCCG · affiliate backup', station: 'WCCG · Duke affiliate', official: 'https://radio.securenetsystems.net/cwa/WCCG' },
  { sourceId: 'duke-wtib', kind: 'affiliate', label: 'WTIB · affiliate backup', station: 'WTIB · Duke affiliate', official: 'https://wtibfm.com/' },
];
// Resolve the stable source route synchronously: playback keeps the browser's user gesture.
for (const team of Object.values(teams)) {
  for (const source of [team, ...(team.backups || [])]) {
    if (source.discovery) continue;
    Object.defineProperty(source, 'url', { enumerable: true, get() {
      return configuredGatewayOrigin() ? relayURL(`/media/live/${source.sourceId}`) : null;
    } });
  }
}
export function getSources(teamKey) {
  const team = teams[teamKey];
  return [{ ...team, label: `${team.name} network · primary` }, ...(team.backups || [])];
}
// Stable source ID of a team's catalog game feed; Georgia Tech keeps its existing ID and saved delays.
export function gameSourceId(teamKey) {
  if (teams[teamKey]?.discovery === 'homestream') return teams[teamKey].sourceId;
  return teams[teamKey] || catalogTeams[teamKey] ? `${teamKey}-game` : 'catalog-game';
}
export const liveSourceIds = [...new Set([...Object.keys(teams).flatMap(key => getSources(key).map(source => source.sourceId)),
  ...[...Object.keys(teams).filter(key => teams[key].catalogId), ...Object.keys(catalogTeams)].map(gameSourceId), 'catalog-game'])];
