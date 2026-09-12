import { readJSON, checkPlaylist } from './homestream.js';
const messages = {
  unpublished: 'This game’s feed has not been published. Refresh closer to the broadcast.',
  missing: 'The published feed is unavailable (404). It may not have started or may have ended.',
  ended: 'This feed has ended. Select another game or refresh the list.',
  stalled: 'The playlist is not advancing. Refresh to check again.',
  unavailable: 'The feed could not be checked. Refresh to retry or use the official listening site.',
  ready: 'Live playlist confirmed. Press Play, then match the audio to your TV.'
};
export function setupHomestream({ onChange, onReady, read = readJSON, probe = checkPlaylist, prefix = '', school = () => 'Georgia Tech' }) {
  const $ = id => document.getElementById(prefix + id);
  let controller, games = [], ready = null, enabled = false;
  const cancel = () => { controller?.abort(); controller = null; ready = null; };
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
    games = []; $('game').replaceChildren();
    $('game').disabled = true; $('game-refresh').disabled = true;
    $('game-note').textContent = `Loading ${school()} games…`;
    try {
      const list = await read(new URL('api/homestream/teams', document.baseURI), { signal });
      if (signal.aborted) return;
      const team = list.find(t => t.name.toLowerCase() === school().toLowerCase());
      if (!team) throw Error('team-unavailable');
      const loaded = await read(new URL(`api/homestream/games/${encodeURIComponent(team.id)}`, document.baseURI), { signal });
      if (signal.aborted) return;
      games = loaded;
      const current = games.find(g => g.id === previous) || [...games].filter(g => g.start !== null).sort((a,b) => Math.abs(a.start-Date.now())-Math.abs(b.start-Date.now()))[0] || games[0];
      $('game').replaceChildren();
      for (const g of games) {
        const option = document.createElement('option'); option.value = g.id;
        option.textContent = `${g.start === null ? g.date || 'Date pending' : new Date(g.start).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} · vs ${g.opponent}${g.url ? '' : ' · feed not published'}`;
        $('game').append(option);
      }
      if (!current) { $('game-note').textContent = `No ${school()} football games are listed. Refresh later.`; onReady(); return; }
      $('game').value = current.id;
      await check(current, signal);
    } catch {
      if (!signal.aborted) { $('game-note').textContent = 'The game catalog could not load. Refresh to retry. This host needs the Homecall catalog service.'; onReady(); }
    } finally {
      if (!signal.aborted) { $('game').disabled = !games.length; $('game-refresh').disabled = false; }
    }
  }
  $('game').onchange = async () => {
    const signal = begin();
    try { await check(games.find(g => g.id === $('game').value), signal); }
    catch { /* An obsolete selection was canceled. */ }
  };
  $('game-refresh').onclick = refresh;
  return {
    get ready() { return ready; },
    refresh,
    setEnabled(value) { enabled = value; cancel(); $('game-panel').hidden = !value; if (value) refresh(); },
    stop() { controller?.abort(); controller = null; $('game').disabled = !games.length; $('game-refresh').disabled = false; },
  };
}
