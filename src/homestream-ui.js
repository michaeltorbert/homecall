import { metadataURL, mediaURL } from './gateway.js';
import { readJSON, checkPlaylist } from './homestream.js';
const messages = {
  unpublished: 'This game’s feed has not been published. Refresh closer to the broadcast.',
  missing: 'The published feed is unavailable (404). It may not have started or may have ended.',
  ended: 'This feed has ended. Select another game or refresh the list.',
  stalled: 'The playlist is not advancing. Refresh to check again.',
  unavailable: 'The feed could not be checked. Refresh to retry or use the official listening site.',
  ready: 'Live playlist confirmed. Press Play, then match the audio to your TV.'
};
// onGames/onCatalogInvalidated are optional label hooks; they never affect readiness or playback.
// guard(kind, proceed, revert) lets the owner confirm a user's game change or refresh before it
// stops playback; revert puts back the committed game while the prompt is pending.
export function setupHomestream({ onChange, onReady, onGames, onCatalogInvalidated, guard = (_kind, proceed) => proceed(), read = readJSON, probe = checkPlaylist, prefix = '', school = () => 'Georgia Tech' }) {
  const api = path => metadataURL(path, document.baseURI, typeof __GATEWAY_ORIGIN__ === 'string' ? __GATEWAY_ORIGIN__ : '', { allowLocal: typeof __GATEWAY_ALLOW_LOCAL__ === 'boolean' && __GATEWAY_ALLOW_LOCAL__ });
  const $ = id => document.getElementById(prefix + id);
  let controller, games = [], ready = null, enabled = false, committed = '';
  const baseLabels = new WeakMap();
  const cancel = () => { controller?.abort(); controller = null; ready = null; };
  const invalidate = () => { try { onCatalogInvalidated?.(); } catch { /* Optional labels cannot block the catalog. */ } };
  const begin = () => { cancel(); onChange(); controller = new AbortController(); return controller.signal; };
  async function check(game, signal) {
    $('game-note').textContent = game?.url ? 'Checking that the live playlist is advancing…' : messages.unpublished;
    const status = game?.url ? await probe(game.url, { signal }) : 'unpublished';
    if (signal.aborted) return;
    ready = status === 'ready' ? game : null;
    $('game-note').textContent = messages[status] || messages.unavailable;
    onReady();
  }
  async function refresh() {
    if (!enabled) return;
    const previous = $('game').value, signal = begin();
    invalidate();
    games = []; $('game').replaceChildren();
    $('game').disabled = true; $('game-refresh').disabled = true;
    $('game-note').textContent = `Loading ${school()} games…`;
    try {
      const list = await read(api('homestream/teams'), { signal });
      if (signal.aborted) return;
      const team = list.find(t => t.name.toLowerCase() === school().toLowerCase());
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
      const current = games.find(g => g.id === previous) || [...games].filter(g => g.start !== null).sort((a,b) => Math.abs(a.start-Date.now())-Math.abs(b.start-Date.now()))[0] || games[0];
      $('game').replaceChildren();
      for (const g of games) {
        const option = document.createElement('option'); option.value = g.id;
        option.textContent = `${g.start === null ? g.date || 'Date pending' : new Date(g.start).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} · vs ${g.opponent}${g.url ? '' : ' · feed not published'}`;
        baseLabels.set(option, option.textContent);
        $('game').append(option);
      }
      if (!current) { $('game-note').textContent = `No ${school()} football games are listed. Refresh later.`; onReady(); return; }
      $('game').value = committed = current.id;
      try { onGames?.(games.map(({id, opponent, start}) => ({id, opponent, start})), {teamId: team.id}); } catch { /* Labels are optional. */ }
      await check(current, signal);
    } catch {
      if (!signal.aborted) { $('game-note').textContent = 'The game catalog could not load. Refresh to retry. This host needs the Homecall catalog service.'; onReady(); }
    } finally {
      if (!signal.aborted) { $('game').disabled = !games.length; $('game-refresh').disabled = false; }
    }
  }
  async function change(id) {
    committed = id;
    const signal = begin();
    try { await check(games.find(g => g.id === id), signal); }
    catch { /* An obsolete selection was canceled. */ }
  }
  $('game').onchange = () => {
    const next = $('game').value;
    return guard('game', () => {
      // A refresh while the prompt was open may have withdrawn the requested game.
      if (![...$('game').options].some(option => option.value === next)) return;
      $('game').value = next;
      return change(next);
    }, () => { $('game').value = committed; });
  };
  $('game-refresh').onclick = () => guard('refresh', refresh);
  return {
    get ready() { return ready; },
    refresh,
    setEnabled(value) { enabled = value; cancel(); invalidate(); $('game-panel').hidden = !value; if (value) refresh(); },
    stop() { controller?.abort(); controller = null; $('game').disabled = !games.length; $('game-refresh').disabled = false; },
    // Text only: value, order, selection, disabled state, focus and readiness are untouched.
    relabel(labels) {
      for (const option of $('game').options) {
        const base = baseLabels.get(option);
        if (base === undefined) continue;
        const prefix = labels.get(option.value);
        const text = prefix ? `${prefix} · ${base}` : base;
        if (option.textContent !== text) option.textContent = text;
      }
    },
  };
}
