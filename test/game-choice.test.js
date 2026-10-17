// Pure default-game policy (issue #39): synthetic catalogs and structured statuses only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultGame, UPCOMING_GRACE } from '../src/game-choice.js';
const NOW = Date.parse('2026-10-14T16:00:00Z'), HOUR = 3600000, DAY = 24 * HOUR;
const g = (id, start) => ({ id, opponent: id, start });
const S = entries => new Map(Object.entries(entries));
const pick = (games, statuses = {}) => defaultGame(games, S(statuses), NOW);

test('the reported Duke case: a nearer completed game never beats the next upcoming one', () => {
  // Shape of the observed catalog: completed Oct 10, an older unavailable record, then upcoming games.
  const games = [g('sep5', NOW - 39 * DAY), g('sep8', NOW - 36 * DAY), g('oct10', NOW - 4 * DAY + 3 * HOUR), g('oct17', NOW + 3 * DAY), g('oct23', NOW + 9 * DAY)];
  const statuses = { sep5: 'completed', sep8: 'unavailable', oct10: 'completed', oct17: 'upcoming', oct23: 'upcoming' };
  assert.deepEqual(pick(games, statuses), { id: 'oct17', reason: 'upcoming', uncertain: false }, 'an older unknown record does not nag');
  assert.deepEqual(pick(games, {}), { id: 'oct17', reason: 'upcoming', uncertain: true }, 'with no status at all the next kickoff is still chosen, with a caution');
});
test('a unique fresh LIVE wins over nearer completed and nearer upcoming games; LIVE never comes from the clock', () => {
  const games = [g('past', NOW - 2 * HOUR), g('live', NOW - 30 * DAY), g('soon', NOW + HOUR)];
  assert.equal(pick(games, { past: 'completed', live: 'live', soon: 'upcoming' }).id, 'live');
  assert.deepEqual(pick(games, { past: 'unavailable', soon: 'upcoming' }), { id: 'soon', reason: 'upcoming', uncertain: true }, 'a just-started unknown game is not called LIVE');
  assert.equal(pick([g('future-live', NOW + DAY), g('soon', NOW + HOUR)], { 'future-live': 'live' }).id, 'future-live', 'fresh provider evidence, not kickoff, decides LIVE');
  assert.equal(pick([g('nodate', null), g('soon', NOW + HOUR)], { nodate: 'live' }).id, 'nodate', 'policy accepts validated LIVE without a start; matching cannot supply one today');
});
test('several LIVE games are ambiguous: neutral, never a tie-break', () => {
  assert.deepEqual(pick([g('a', NOW - HOUR), g('b', NOW - 2 * HOUR), g('c', NOW + DAY)], { a: 'live', b: 'live', c: 'upcoming' }), { id: null, reason: 'ambiguous', uncertain: false });
});
test('next upcoming: earliest future kickoff, excluding a freshly completed one; provider Upcoming beyond the grace is not next', () => {
  const games = [g('late', NOW + 9 * DAY), g('done', NOW + HOUR), g('next', NOW + 2 * DAY), g('stale-upcoming', NOW - 7 * HOUR)];
  assert.deepEqual(pick(games, { done: 'completed', 'stale-upcoming': 'upcoming' }), { id: 'next', reason: 'upcoming', uncertain: true }, 'an old provider Upcoming stays unconfirmed');
  assert.deepEqual(pick([...games.slice(0, 3), g('recent-upcoming', NOW - HOUR)], { done: 'completed', 'recent-upcoming': 'upcoming' }), { id: 'recent-upcoming', reason: 'upcoming', uncertain: false },
    'within the grace a fresh provider Upcoming is the next game (deliberate policy change from the earlier rule)');
  assert.equal(pick([g('a', NOW + DAY), g('b', NOW + DAY)]).id, 'a', 'equal kickoffs keep catalog order');
  assert.equal(pick([g('placeholder', Date.parse('2026-10-31T16:34:00Z')), g('real', Date.parse('2026-11-07T17:00:00Z'))], { placeholder: 'unavailable' }).id, 'placeholder',
    'a placeholder kickoff only orders games; a failed status match does not exclude it');
});
test('no live or future game: strong absence only when every listed game is freshly completed', () => {
  const past = [g('a', NOW - 9 * DAY), g('b', NOW - 2 * DAY)];
  assert.deepEqual(pick(past, { a: 'completed', b: 'completed' }), { id: null, reason: 'none', uncertain: false });
  assert.equal(pick(past, { a: 'unavailable', b: 'completed' }).reason, 'unconfirmed', 'one old unknown record blocks the strong claim');
  assert.equal(pick(past, { a: 'completed', b: 'upcoming' }).reason, 'unconfirmed');
  assert.equal(pick(past, {}).reason, 'unconfirmed', 'a failed or expired status request never proves absence');
  assert.equal(pick([...past, g('pending', null)], { a: 'completed', b: 'completed' }).reason, 'unconfirmed', 'a date-pending game blocks the strong claim');
  assert.equal(pick([...past, g('cancelled-future', NOW + DAY)], { a: 'completed', b: 'completed', 'cancelled-future': 'completed' }).reason, 'unconfirmed', 'a future game reported completed is not a past completed game');
  assert.deepEqual(pick([]), { id: null, reason: 'empty', uncertain: false });
  assert.deepEqual(pick([g('only-pending', null)]), { id: null, reason: 'unconfirmed', uncertain: false });
});
test('the observed GT shape: minutes after kickoff a fresh provider Upcoming is still the game, published or not', () => {
  const T = NOW - 2.5 * 60000, at = NOW - 7 * DAY;
  const shape = (todayURL, nextURL) => [{ ...g('prev', at), url: 'https://example.test/prev' }, { ...g('today', T), url: todayURL }, { ...g('nextweek', T + 7 * DAY), url: nextURL }];
  const statuses = { prev: 'completed', today: 'upcoming', nextweek: 'upcoming' };
  const expected = { id: 'today', reason: 'upcoming', uncertain: false };
  assert.deepEqual(pick(shape('https://example.test/today', null), statuses), expected);
  assert.deepEqual(pick(shape(null, null), statuses), expected, 'publication never changes the choice');
  assert.deepEqual(pick(shape(null, 'https://example.test/next'), statuses), expected);
});
test('the grace is inclusive at kickoff and at exactly UPCOMING_GRACE, and ends just beyond it', () => {
  assert.equal(UPCOMING_GRACE, 6 * HOUR);
  const later = g('later', NOW + 7 * DAY);
  assert.equal(pick([g('now', NOW), later], { now: 'upcoming' }).id, 'now');
  assert.equal(pick([g('edge', NOW - UPCOMING_GRACE), later], { edge: 'upcoming' }).id, 'edge');
  assert.deepEqual(pick([g('over', NOW - UPCOMING_GRACE - 1), later], { over: 'upcoming' }), { id: 'later', reason: 'upcoming', uncertain: true });
  assert.equal(pick([g('over', NOW - UPCOMING_GRACE - 1)], { over: 'upcoming' }).reason, 'unconfirmed');
});
test('only a fresh structured Upcoming earns the grace: unknown, completed and old postponed games never do', () => {
  const later = g('later', NOW + 7 * DAY), recent = g('recent', NOW - HOUR);
  for (const statuses of [{}, { recent: 'unavailable' }, { recent: 'unknown' }]) // missing or expired, unavailable, unmapped unknown
    assert.deepEqual(pick([recent, later], statuses), { id: 'later', reason: 'upcoming', uncertain: true });
  assert.deepEqual(pick([recent, later], { recent: 'completed' }), { id: 'later', reason: 'upcoming', uncertain: false });
  assert.deepEqual(pick([g('postponed', NOW - 3 * DAY), later], { postponed: 'upcoming' }), { id: 'later', reason: 'upcoming', uncertain: true }, 'a stuck or postponed Upcoming stays unconfirmed');
  assert.equal(pick([recent], { recent: 'upcoming' }).reason, 'upcoming', 'a lone recent Upcoming is chosen instead of unconfirmed');
  assert.equal(pick([recent], {}).reason, 'unconfirmed');
});
test('LIVE still comes first, and several LIVE stay ambiguous, over a recent Upcoming', () => {
  const games = [g('recent', NOW - HOUR), g('a', NOW - 2 * HOUR), g('b', NOW - 3 * HOUR)];
  assert.deepEqual(pick(games, { recent: 'upcoming', a: 'live' }), { id: 'a', reason: 'live', uncertain: false });
  assert.deepEqual(pick(games, { recent: 'upcoming', a: 'live', b: 'live' }), { id: null, reason: 'ambiguous', uncertain: false });
});
test('a chosen recent Upcoming: earliest start wins with stable ties; the caution looks at the latest other started game', () => {
  const later = g('later', NOW + DAY);
  assert.equal(pick([later, g('x', NOW - 2 * HOUR), g('y', NOW - 2 * HOUR)], { x: 'upcoming', y: 'upcoming' }).id, 'x', 'equal kickoffs keep catalog order');
  assert.equal(pick([g('newer', NOW - HOUR), g('older', NOW - 5 * HOUR), later], { newer: 'upcoming', older: 'upcoming' }).id, 'older');
  const games = [g('prev', NOW - DAY), g('chosen', NOW - HOUR), later];
  assert.deepEqual(pick(games, { prev: 'completed', chosen: 'upcoming' }), { id: 'chosen', reason: 'upcoming', uncertain: false }, 'the chosen game does not caution itself');
  assert.deepEqual(pick(games, { prev: 'unavailable', chosen: 'upcoming' }), { id: 'chosen', reason: 'upcoming', uncertain: true });
  const after = [g('chosen', NOW - 5 * HOUR), g('other', NOW - HOUR), later];
  assert.equal(pick(after, { chosen: 'upcoming', other: 'unavailable' }).uncertain, true, 'a later-started unknown game still cautions');
  assert.equal(pick(after, { chosen: 'upcoming', other: 'completed' }).uncertain, false);
});
test('the caution looks only at the most recent started game', () => {
  const games = [g('old', NOW - 30 * DAY), g('recent', NOW - DAY), g('next', NOW + DAY)];
  assert.equal(pick(games, { old: 'unavailable', recent: 'completed' }).uncertain, false);
  assert.equal(pick(games, { old: 'completed', recent: 'unavailable' }).uncertain, true);
  assert.equal(pick([g('next', NOW + DAY)]).uncertain, false, 'no started game, nothing to caution');
});
