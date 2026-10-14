// The game Listen selects when the listener has not chosen one for this school. Pure: catalog games,
// structured fresh statuses (live, upcoming, completed or unavailable; never label text) and now.
// A kickoff time only orders games: it never makes a game LIVE and is not the broadcast start.
// Result: { id, reason, uncertain }. id is null when the listener must choose:
//   live        the only game the sports-data source freshly reports LIVE
//   upcoming    the earliest future kickoff not freshly reported Completed; uncertain when the most
//               recent started game has no confirmed status, so the choice is not proof nothing is on
//   ambiguous   several games are reported LIVE; which one is not invented
//   none        every listed game is in the past and freshly Completed
//   unconfirmed no future kickoff, and some game is unconfirmed or has no date
//   empty       the catalog lists no games
export function defaultGame(games, statuses = new Map(), now = Date.now()) {
  const state = id => statuses.get(id) ?? 'unavailable';
  const live = games.filter(g => state(g.id) === 'live');
  if (live.length > 1) return { id: null, reason: 'ambiguous', uncertain: false };
  if (live.length === 1) return { id: live[0].id, reason: 'live', uncertain: false };
  const dated = games.filter(g => Number.isFinite(g.start));
  const next = dated.filter(g => g.start > now && state(g.id) !== 'completed').sort((a, b) => a.start - b.start)[0];
  if (next) {
    const latest = dated.filter(g => g.start <= now).sort((a, b) => b.start - a.start)[0];
    return { id: next.id, reason: 'upcoming', uncertain: !!latest && state(latest.id) !== 'completed' };
  }
  if (!games.length) return { id: null, reason: 'empty', uncertain: false };
  const none = games.every(g => Number.isFinite(g.start) && g.start <= now && state(g.id) === 'completed');
  return { id: null, reason: none ? 'none' : 'unconfirmed', uncertain: false };
}
