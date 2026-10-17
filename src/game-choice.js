// The game Listen selects when the listener has not chosen one for this school. Pure: catalog games,
// structured fresh statuses (live, upcoming, completed or unavailable; never label text) and now.
// A scheduled kickoff orders games and bounds how long a provider Upcoming stays eligible; it never
// makes a game LIVE, does not show a game actually started and is not the broadcast start.
// Result: { id, reason, uncertain }. id is null when the listener must choose:
//   live        the only game the sports-data source freshly reports LIVE
//   upcoming    the earliest future kickoff not freshly reported Completed, or a game whose scheduled
//               kickoff passed within UPCOMING_GRACE and is still freshly reported Upcoming; uncertain when
//               the most recent other game past its scheduled kickoff has no confirmed status, so the
//               choice is not proof nothing is on
//   ambiguous   several games are reported LIVE; which one is not invented
//   none        every listed game is in the past and freshly Completed
//   unconfirmed no eligible upcoming game, and some game is unconfirmed or has no date
//   empty       the catalog lists no games
// Product judgment, not a fact about how late games run: how long after its scheduled kickoff has
// passed a fresh provider Upcoming still counts as the next game. Bounded so a stuck or postponed provider state cannot
// keep an old game selected.
export const UPCOMING_GRACE = 6 * 3600000;
export function defaultGame(games, statuses = new Map(), now = Date.now()) {
  const state = id => statuses.get(id) ?? 'unavailable';
  const live = games.filter(g => state(g.id) === 'live');
  if (live.length > 1) return { id: null, reason: 'ambiguous', uncertain: false };
  if (live.length === 1) return { id: live[0].id, reason: 'live', uncertain: false };
  const dated = games.filter(g => Number.isFinite(g.start));
  const recent = g => state(g.id) === 'upcoming' && now - g.start >= 0 && now - g.start <= UPCOMING_GRACE;
  const next = dated.filter(g => state(g.id) !== 'completed' && (g.start > now || recent(g))).sort((a, b) => a.start - b.start)[0];
  if (next) {
    const latest = dated.filter(g => g !== next && g.start <= now).sort((a, b) => b.start - a.start)[0];
    return { id: next.id, reason: 'upcoming', uncertain: !!latest && state(latest.id) !== 'completed' };
  }
  if (!games.length) return { id: null, reason: 'empty', uncertain: false };
  const none = games.every(g => Number.isFinite(g.start) && g.start <= now && state(g.id) === 'completed');
  return { id: null, reason: none ? 'none' : 'unconfirmed', uncertain: false };
}
