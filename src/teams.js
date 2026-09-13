export const teams = {
  gt: { name: 'Georgia Tech', nickname: 'Yellow Jackets', sourceId: 'gt-homestream', station: 'Georgia Tech · Homestream', discovery: 'homestream', official: 'https://ramblinwreck.com/radio', color: '#d9bc7a' },
  duke: { name: 'Duke', nickname: 'Blue Devils', sourceId: 'duke-leanstream', station: 'Duke Sports Network', url: 'https://learfield-gd.leanstream.co/IM3501-MP3', official: 'https://duke.leanplayer.com/', color: '#8daeff' },
  miami: { name: 'Miami', nickname: 'Hurricanes', sourceId: 'miami-wqam', station: '104.3 WQAM', url: 'https://live.amperwave.net/direct/audacy-wqamfmmp3-imc', official: 'https://www.audacy.com/stations/wqam', color: '#ffaf70' },
  vt: { name: 'Virginia Tech', nickname: 'Hokies', sourceId: 'vt-leanstream', station: 'Virginia Tech Sports Network', url: 'https://wmt.leanstream.co/WM0401', official: 'https://hokiesports.com/virginia-tech-sports-network', color: '#ed9dab' }
};

// These affiliates carried Duke postgame in audio samples on 2026-09-12.
// Availability and programming can change; offer explicit choices, not automatic station hopping.
teams.duke.backups = [
  { sourceId: 'duke-varsity', label: 'Duke network · backup connection', station: 'Duke Sports Network · backup', url: 'https://img.leanstream.co/IM3501-MP3', official: 'https://thevarsitynetwork.com/feed/source/oas-1693', note: 'An alternate connection to the Duke network used by Varsity. It shares the same broadcast provider as the primary.' },
  { sourceId: 'duke-wsjs', label: 'WSJS · affiliate backup', station: 'WSJS · Duke affiliate', url: 'https://stream.falconinternet.net:9050/;mp3', official: 'https://broadcast.truthnetwork.com/player-wsjs.lasso?p=wsjs' },
  { sourceId: 'duke-wccg', label: 'WCCG · affiliate backup', station: 'WCCG · Duke affiliate', url: 'https://ice66.securenetsystems.net/WCCG', official: 'https://radio.securenetsystems.net/cwa/WCCG' },
  { sourceId: 'duke-wtib', label: 'WTIB · affiliate backup', station: 'WTIB · Duke affiliate', url: 'https://live.innerbanksmedia.com:8080/wtib', official: 'https://wtibfm.com/' },
];
export function getSources(teamKey) {
  const team = teams[teamKey];
  return [{ ...team, label: `${team.name} network · primary` }, ...(team.backups || [])];
}
export const liveSourceIds = Object.keys(teams).flatMap(key => getSources(key).map(source => source.sourceId));
