// Favorite team preference (issues #59/#68): explicit, nullable, separate from the Player team.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeamPreferences, FAVORITE_KEY, PROMPT_KEY } from '../src/team-preferences.js';
const memoryStorage = (seed = {}) => { const map = new Map(Object.entries(seed)); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), map }; };
const valid = key => ['duke', 'miami', 'vt', 'auburn'].includes(key) || /^catalog:[0-9a-f-]{36}$/.test(key);

test('a legacy or default Player team is never a favorite; the first visit is unanswered', () => {
  const storage = memoryStorage({ 'mystream.team': 'duke' });
  const prefs = createTeamPreferences({ storage, valid });
  assert.equal(prefs.favorite, null); assert.equal(prefs.answered, false);
  assert.equal(storage.map.has(FAVORITE_KEY), false, 'reading never writes a favorite');
});
test('skip and star persist separately and never ask again; clearing a star keeps the prompt answered', () => {
  const storage = memoryStorage();
  let prefs = createTeamPreferences({ storage, valid });
  assert.equal(prefs.skip(), true); assert.equal(prefs.favorite, null); assert.equal(prefs.answered, true);
  prefs = createTeamPreferences({ storage, valid }); assert.equal(prefs.answered, true, 'a skip survives reload');
  let calls = 0; prefs.subscribe(() => calls++);
  assert.equal(prefs.setFavorite('miami'), true); assert.equal(calls, 1);
  prefs = createTeamPreferences({ storage, valid }); assert.equal(prefs.favorite, 'miami');
  prefs.setFavorite(null); prefs = createTeamPreferences({ storage, valid });
  assert.equal(prefs.favorite, null); assert.equal(prefs.answered, true); assert.equal(storage.map.get(PROMPT_KEY), 'chosen');
});
test('invalid keys are refused; a valid catalog school the catalog does not list right now is kept', () => {
  const storage = memoryStorage({ [FAVORITE_KEY]: 'catalog:00000000-0000-4000-8000-000000000001' });
  const prefs = createTeamPreferences({ storage, valid });
  assert.equal(prefs.favorite, 'catalog:00000000-0000-4000-8000-000000000001');
  assert.equal(prefs.setFavorite('https://elsewhere'), false); assert.equal(prefs.favorite, 'catalog:00000000-0000-4000-8000-000000000001');
  assert.equal(createTeamPreferences({ storage: memoryStorage({ [FAVORITE_KEY]: 'bogus' }), valid }).favorite, null);
});
test('a storage failure keeps the in-page choice and says it was not saved', () => {
  const warnings = [];
  const storage = { getItem: () => null, setItem: () => { throw Error('quota'); }, removeItem: () => { throw Error('quota'); } };
  const prefs = createTeamPreferences({ storage, valid, onWarning: text => warnings.push(text) });
  assert.equal(prefs.setFavorite('vt'), false); assert.equal(prefs.favorite, 'vt');
  assert.match(warnings[0], /could not be saved/);
  assert.equal(createTeamPreferences({ storage: undefined, valid }).favorite, null, 'no storage reads as no favorite');
});
