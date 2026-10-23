// The listener's favorite team (issues #59/#68). An explicit, nullable choice kept apart from the team
// the Player last committed (mystream.team) and from any team being browsed. A legacy or default
// Player team is never promoted to a favorite: only a star or the first-visit choice sets one.
// Storage failure keeps the choice for this page and reports it; it never blocks listening.
export const FAVORITE_KEY = 'homecall.favoriteTeam';
export const PROMPT_KEY = 'homecall.favoritePrompt';
const CATALOG_KEY = /^catalog:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// valid(key) says whether a key can name a school at all (configured keys or catalog:<id>). A valid
// favorite the catalog does not list right now is kept, not silently discarded.
export function createTeamPreferences({ storage, valid = key => CATALOG_KEY.test(key), onWarning = () => {} } = {}) {
  const read = key => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
  const saved = read(FAVORITE_KEY);
  let favorite = typeof saved === 'string' && valid(saved) ? saved : null;
  // answered: the listener chose, skipped or later cleared a favorite; the first-visit prompt never repeats.
  let answered = !!favorite || ['skipped', 'chosen'].includes(read(PROMPT_KEY));
  const listeners = new Set();
  function write(key, value) {
    try {
      if (!storage) throw Error('storage unavailable');
      if (value === null) storage.removeItem(key); else storage.setItem(key, value);
      return true;
    } catch { onWarning('Your favorite team could not be saved on this browser. It applies until you leave this page.'); return false; }
  }
  const notify = () => { for (const fn of listeners) { try { fn(); } catch { /* A view cannot block the preference. */ } } };
  return {
    get favorite() { return favorite; },
    get answered() { return answered; },
    // Returns whether the choice was persisted; the in-page choice applies either way.
    setFavorite(key) {
      if (key !== null && (typeof key !== 'string' || !valid(key))) return false;
      favorite = key; answered = true;
      const ok = write(FAVORITE_KEY, key) && write(PROMPT_KEY, 'chosen');
      notify(); return ok;
    },
    skip() {
      if (answered) return true;
      answered = true;
      const ok = write(PROMPT_KEY, 'skipped');
      notify(); return ok;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
