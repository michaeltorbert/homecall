// Pure default-game policy (issue #39): synthetic catalogs and structured statuses only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultGame } from '../src/game-choice.js';
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
test('next upcoming: earliest future kickoff, excluding a freshly completed one; provider Upcoming in the past is not next', () => {
  const games = [g('late', NOW + 9 * DAY), g('done', NOW + HOUR), g('next', NOW + 2 * DAY), g('stale-upcoming', NOW - HOUR)];
  assert.deepEqual(pick(games, { done: 'completed', 'stale-upcoming': 'upcoming' }), { id: 'next', reason: 'upcoming', uncertain: true }, 'a past provider Upcoming stays unconfirmed');
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
test('the caution looks only at the most recent started game', () => {
  const games = [g('old', NOW - 30 * DAY), g('recent', NOW - DAY), g('next', NOW + DAY)];
  assert.equal(pick(games, { old: 'unavailable', recent: 'completed' }).uncertain, false);
  assert.equal(pick(games, { old: 'completed', recent: 'unavailable' }).uncertain, true);
  assert.equal(pick([g('next', NOW + DAY)]).uncertain, false, 'no started game, nothing to caution');
});
