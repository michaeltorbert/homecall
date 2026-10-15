import { metadataURL, mediaURL } from './gateway.js';
import { readJSON, checkPlaylist } from './homestream.js';
import { defaultGame } from './game-choice.js';
const messages = {
  unpublished: 'This game’s feed has not been published. Refresh closer to the broadcast.',
  missing: 'The published feed is unavailable (404). It may not have started or may have ended.',
  ended: 'This feed has ended. Select another game or refresh the list.',
  stalled: 'The playlist is not advancing. Refresh to check again.',
  unavailable: 'The feed could not be checked. Refresh to retry or use the official listening site.',
  catalog: 'The game catalog could not load. Refresh to retry. This host needs the Homecall catalog service.',
  ready: 'Live playlist confirmed. Press Play, then match the audio to your TV.'
};
// Why the Game choice is left neutral. Absence is claimed only when every listed game is freshly Completed.
const choose = {
  ambiguous: school => `More than one ${school} game is reported LIVE. Choose a game.`,
  none: school => `No live or upcoming ${school} games are listed. Choose a past game to check its feed.`,
  unconfirmed: school => `No live or upcoming ${school} game could be confirmed. Choose a listed game.`,
  missing: () => 'The game you chose is no longer listed. Choose a listed game.',
  manual: () => 'Choose a game to check its feed.'
};
const UNCERTAIN = 'Live status could not be confirmed for the most recent game.';
// Kickoff wording (issue #44). A catalog time is shown as confirmed only when fresh provider data
// confirms it; a provider TBD shows the catalog's own calendar date, read in UTC so a YYYY-MM-DD
// never shifts a day, and never falls back to the catalog start. See KICKOFF-TIMES.md.
function calendarDate(value) {
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const day = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  return day && day.toISOString().slice(0, 10) === value ? day.toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'Date pending';
}
function kickoffText(g, kickoff) {
  if (g.start === null) return g.date || 'Date pending';
  if (kickoff === 'tbd') return `${calendarDate(g.date)}, Time TBD`;
  const time = new Date(g.start).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  // The warning leads the time so a narrow closed select can never truncate it away.
  return kickoff === 'confirmed' ? time : `Unconfirmed time: ${time}`;
}
const gameLabel = (g, kickoff) => `${kickoffText(g, kickoff)} · vs ${g.opponent}${g.url ? '' : ' · feed not published'}`;
// The default game waits at most this long for the first status round.
const INITIAL_WAIT_MS = 4000;
// onGames/onCatalogInvalidated are optional label hooks; they never affect readiness or playback.
// guard(kind, proceed, revert) lets the owner confirm a user's game change or refresh before it
// stops playback; revert puts back the committed game while the prompt is pending.
// teamId, when it returns an ID, matches the catalog team by that explicit ID instead of its name.
// onChange receives 'refresh' or 'game' so the owner can tell a reload from a new game choice.
// Default game: when a school is enabled with no game committed for it on this page, one bounded
// statuses(signal) round (structured fresh states) feeds defaultGame. epoch and idle let the owner
// veto it: the choice commits only if epoch() is unchanged since the load began and idle() holds.
// Otherwise it is retired for good. Committing a default never calls onChange.
export function setupHomestream({ onChange, onReady, onGames, onCatalogInvalidated, guard = (_kind, proceed) => proceed(), read = readJSON, probe = checkPlaylist, prefix = '', school = () => 'Georgia Tech', teamId = () => null,
  statuses = null, epoch = () => 0, idle = () => true }) {
  const api = path => metadataURL(path, document.baseURI, typeof __GATEWAY_ORIGIN__ === 'string' ? __GATEWAY_ORIGIN__ : '', { allowLocal: typeof __GATEWAY_ALLOW_LOCAL__ === 'boolean' && __GATEWAY_ALLOW_LOCAL__ });
  const $ = id => document.getElementById(prefix + id);
  // idle (disabled), loading, checking, ready or unavailable: what the owner may say before Play.
  // committed is the selected game of the catalog team committedTeam; it never carries to another team.
  let controller, games = [], ready = null, enabled = false, committed = '', committedTeam = null, status = 'idle', caution = '';
  const optionGames = new WeakMap();
  const cancel = () => { controller?.abort(); controller = null; ready = null; };
  const invalidate = () => { try { onCatalogInvalidated?.(); } catch { /* Optional labels cannot block the catalog. */ } };
  // Readiness is unknown from the moment a reload or game change begins, before the owner re-renders.
  const begin = kind => { cancel(); status = 'loading'; onChange(kind); controller = new AbortController(); return controller.signal; };
  function focusIntent(button, signal) {
    let valid = true;
    const moved = event => {
      if (event.type === 'focusin' && event.target === button) return;
      valid = false;
    };
    const clear = () => {
      document.removeEventListener('keydown', moved, true);
      document.removeEventListener('pointerdown', moved, true);
      document.removeEventListener('click', moved, true);
      document.removeEventListener('change', moved, true);
      document.removeEventListener('focusin', moved, true);
      signal.removeEventListener('abort', clear);
    };
    document.addEventListener('keydown', moved, true);
    document.addEventListener('pointerdown', moved, true);
    document.addEventListener('click', moved, true);
    document.addEventListener('change', moved, true);
    document.addEventListener('focusin', moved, true);
    signal.addEventListener('abort', clear, { once: true });
    return {
      clear,
      restore() {
        const active = document.activeElement;
        const panel = $('game-panel');
        const fallback = !active || active === document.body || active === document.documentElement;
        const visible = button.isConnected && button.getClientRects().length > 0 && panel && !panel.hidden;
        if (valid && !signal.aborted && controller?.signal === signal && visible && (active === button || fallback) && active !== button) button.focus();
        clear();
      }
    };
  }
  const note = text => { $('game-note').textContent = caution ? `${caution} ${text}` : text; };
  // A disabled, value-less first option keeps the Game choice neutral; a choice removes it.
  function placeholder(text) {
    let option = $('game').querySelector('option[value=""]');
    if (!option) { option = document.createElement('option'); option.value = ''; option.disabled = true; $('game').prepend(option); }
    option.textContent = text; $('game').value = '';
  }
  const unplace = () => { $('game').querySelector('option[value=""]')?.remove(); };
  function neutral(text) { placeholder('Choose a game'); committed = ''; status = 'unavailable'; $('game-note').textContent = text; onReady(); }
  // Copies the hook's id -> state entries into a local Map by iteration, never by a realm-bound type
  // check; anything that is not entries reads as no status.
  const statesOf = value => { try { return new Map(value ?? []); } catch { return new Map(); } };
  // The first status round, bounded by INITIAL_WAIT_MS and the load signal even when the hook ignores both.
  // The deadline and an abort settle with no status.
  function firstStatuses(signal) {
    if (!statuses) return Promise.resolve(new Map());
    return new Promise(resolve => {
      const finish = value => { clearTimeout(timer); signal.removeEventListener('abort', stop); resolve(statesOf(value)); };
      const stop = () => finish();
      const timer = setTimeout(stop, INITIAL_WAIT_MS);
      signal.addEventListener('abort', stop, { once: true });
      Promise.resolve().then(() => statuses(signal)).then(finish, stop);
    });
  }
  async function check(game, signal) {
    status = game?.url ? 'checking' : 'unavailable';
    note(game?.url ? 'Checking that the live playlist is advancing…' : messages.unpublished);
    const result = game?.url ? await probe(game.url, { signal }) : 'unpublished';
    if (signal.aborted) return;
    ready = result === 'ready' ? game : null; status = ready ? 'ready' : 'unavailable';
    note(messages[result] || messages.unavailable);
    onReady();
  }
  // initial: a team was enabled, so a default may be chosen. An explicit refresh only keeps a choice.
  async function load(initial) {
    if (!enabled) return;
    const refreshButton = $('game-refresh');
    const wantsFocus = !initial && document.activeElement === refreshButton;
    const signal = begin('refresh'), owner = epoch();
    invalidate(); status = 'loading'; caution = '';
    games = []; $('game').replaceChildren();
    $('game').disabled = true; refreshButton.disabled = true;
    const refreshFocus = wantsFocus ? focusIntent(refreshButton, signal) : null;
    $('game-note').textContent = `Loading ${school()} games…`;
    try {
      const list = await read(api('homestream/teams'), { signal });
      if (signal.aborted) return;
      const id = teamId();
      const team = id ? list.find(t => t.id === id) : list.find(t => t.name.toLowerCase() === school().toLowerCase());
      if (!team && id) { status = 'unavailable'; $('game-note').textContent = `No ${school()} game feeds are listed right now.`; onReady(); return; }
      if (!team) throw Error('team-unavailable');
      const loaded = await read(api(`homestream/games/${encodeURIComponent(team.id)}`), { signal });
      if (signal.aborted) return;
      if (!Array.isArray(loaded)) throw Error('catalog-invalid');
      games = loaded.map(game => {
        if (!game || !/^[A-Za-z0-9_-]+$/.test(game.id) || typeof game.opponent !== 'string' || !(game.start === null || Number.isFinite(game.start))) throw Error('catalog-invalid');
        const url = game.url === null ? null : mediaURL(game.url, { origin: typeof __GATEWAY_ORIGIN__ === 'string' ? __GATEWAY_ORIGIN__ : '', allowLocal: typeof __GATEWAY_ALLOW_LOCAL__ === 'boolean' && __GATEWAY_ALLOW_LOCAL__, path: `/media/game/${team.id}/${game.id}` });
        if (game.url !== null && !url) throw Error('catalog-invalid');
        return { ...game, url };
      });
      // Only this team's own committed game is kept; a shared game ID under another school is not.
      const kept = committedTeam === team.id ? committed : '';
      committed = ''; committedTeam = team.id;
      $('game').replaceChildren();
      for (const g of games) {
        const option = document.createElement('option'); option.value = g.id;
        // Unconfirmed until a fresh status publishes kickoff confidence.
        option.textContent = gameLabel(g);
        optionGames.set(option, g);
        $('game').append(option);
      }
      if (!games.length) { status = 'unavailable'; $('game-note').textContent = `No ${school()} football games are listed. Refresh later.`; onReady(); return; }
      const retained = games.find(g => g.id === kept);
      if (retained) $('game').value = committed = retained.id;
      else placeholder(initial && !kept ? 'Finding the live or next game…' : 'Choose a game');
      try { onGames?.(games.map(({id, opponent, start}) => ({id, opponent, start})), {teamId: team.id}); } catch { /* Labels are optional. */ }
      // A kept choice, including a past or unpublished game, is probed without any status wait.
      if (retained) { await check(retained, signal); return; }
      if (kept) { neutral(choose.missing()); return; }
      if (!initial) { neutral(choose.manual()); return; }
      // A manual game choice stays open during the wait; it cancels this load and retires the default.
      $('game').disabled = false;
      $('game-note').textContent = `Finding the live or next ${school()} game…`;
      const fresh = await firstStatuses(signal);
      if (signal.aborted) return;
      // Any listener action or listening intent since the load began retires the default for good.
      if (epoch() !== owner || !idle()) { neutral(choose.manual()); return; }
      const choice = defaultGame(games, fresh);
      const current = games.find(g => g.id === choice.id);
      if (!current) { neutral(choose[choice.reason]?.(school()) ?? choose.manual()); return; }
      unplace(); $('game').value = committed = current.id;
      caution = choice.uncertain ? UNCERTAIN : '';
      await check(current, signal);
    } catch {
      if (!signal.aborted) { status = 'unavailable'; $('game-note').textContent = messages.catalog; onReady(); }
    } finally {
      if (!signal.aborted) {
        $('game').disabled = !games.length; refreshButton.disabled = false;
        refreshFocus?.restore();
      } else refreshFocus?.clear();
    }
  }
  async function change(id) {
    committed = id; caution = '';
    const signal = begin('game');
    unplace(); $('game-refresh').disabled = false;
    try { await check(games.find(g => g.id === id), signal); }
    catch { /* An obsolete selection was canceled. */ }
  }
  $('game').onchange = () => {
    const next = $('game').value;
    return guard('game', () => {
      // A refresh while the prompt was open may have withdrawn the requested game.
      // The neutral placeholder is never a game.
      if (!games.some(g => g.id === next)) return;
      $('game').value = next;
      return change(next);
    }, () => { $('game').value = committed; });
  };
  const refresh = () => load(false);
  $('game-refresh').onclick = () => guard('refresh', refresh);
  return {
    get ready() { return ready; },
    get status() { return status; },
    refresh,
    setEnabled(value) { enabled = value; cancel(); invalidate(); status = 'idle'; $('game-panel').hidden = !value; if (value) load(true); },
    stop() { controller?.abort(); controller = null; if (status === 'loading' || status === 'checking') status = 'unavailable'; $('game').disabled = !games.length; $('game-refresh').disabled = false; },
    // Text only: value, order, selection, disabled state, focus and readiness are untouched.
    // kickoffs maps game ID to 'confirmed' or 'tbd'; any other game shows its time as unconfirmed.
    relabel(labels, kickoffs = new Map()) {
      for (const option of $('game').options) {
        const game = optionGames.get(option);
        if (game === undefined) continue;
        const base = gameLabel(game, kickoffs.get(option.value));
        const prefix = labels.get(option.value);
        const text = prefix ? `${prefix} · ${base}` : base;
        if (option.textContent !== text) option.textContent = text;
      }
    },
  };
}
