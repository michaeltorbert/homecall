import { relayURL, configuredGatewayOrigin } from './gateway.js';
export const teams = {
  gt: { name: 'Georgia Tech', nickname: 'Yellow Jackets', sourceId: 'gt-homestream', station: 'Georgia Tech · Homestream', discovery: 'homestream', official: 'https://ramblinwreck.com/radio', color: '#d9bc7a' },
  duke: { name: 'Duke', nickname: 'Blue Devils', sourceId: 'duke-leanstream', station: 'Duke Sports Network', official: 'https://duke.leanplayer.com/', color: '#8daeff' },
  miami: { name: 'Miami', nickname: 'Hurricanes', sourceId: 'miami-wqam', station: '104.3 WQAM', official: 'https://www.audacy.com/stations/wqam', color: '#ffaf70' },
  vt: { name: 'Virginia Tech', nickname: 'Hokies', sourceId: 'vt-leanstream', station: 'Virginia Tech Sports Network', official: 'https://hokiesports.com/virginia-tech-sports-network', color: '#ed9dab' }
};

// These affiliates carried Duke postgame in audio samples on 2026-09-12.
// Availability and programming can change; offer explicit choices, not automatic station hopping.
teams.duke.backups = [
  { sourceId: 'duke-varsity', label: 'Duke network · backup connection', station: 'Duke Sports Network · backup', official: 'https://thevarsitynetwork.com/feed/source/oas-1693', note: 'An alternate connection to the Duke network used by Varsity. It shares the same broadcast provider as the primary.' },
  { sourceId: 'duke-wsjs', label: 'WSJS · affiliate backup', station: 'WSJS · Duke affiliate', official: 'https://broadcast.truthnetwork.com/player-wsjs.lasso?p=wsjs' },
  { sourceId: 'duke-wccg', label: 'WCCG · affiliate backup', station: 'WCCG · Duke affiliate', official: 'https://radio.securenetsystems.net/cwa/WCCG' },
  { sourceId: 'duke-wtib', label: 'WTIB · affiliate backup', station: 'WTIB · Duke affiliate', official: 'https://wtibfm.com/' },
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
export const liveSourceIds = Object.keys(teams).flatMap(key => getSources(key).map(source => source.sourceId));
