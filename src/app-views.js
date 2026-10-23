// Presentation only. Persistent controls and their guarded handlers remain the state owners.
// Three separate team identities appear here and never stand in for each other:
//   favorite  the listener's explicit Home team (prefs), possibly none
//   browsed   the team whose page is open; read-only, it never touches audio or the Player
//   Player    the committed Listen team (snapshot().team), which owns sources, game and playback
import { teams, catalogTeams, getSources } from './teams.js';
import { openDialog, closeDialog, onDismiss } from './ui-shell.js';
import { currentWeek } from './browse-catalog.js';
export function listeningHistory(records) {
  return records.filter(item => item.mode !== 'demo' && item.sourceId !== 'test-tone' && item.events.some(event => event?.type === 'output-ready')).map(item => {
    const sourceId = typeof item.sourceId === 'string' ? item.sourceId : '';
    const school = teams[item.team] ?? catalogTeams[item.team];
    const source = teams[item.team] ? getSources(item.team).find(source => source.sourceId === item.sourceId) : null;
    return { id: item.id, title: school?.name ?? (item.team === 'catalog' ? 'Catalog school' : 'Unknown school'), source: source?.station ?? (sourceId.endsWith('-game') || item.sourceId === 'catalog-game' || item.sourceId === 'gt-homestream' ? 'Game feed' : 'Source not retained'), at: item.startedAt };
  });
}
// Preserve the countdown controller's exact text/freshness state; only group its own output.
export function renderNetworkSchedule(doc, target, text) {
  if (target.hidden !== !text) target.hidden = !text;
  if (!text || target.dataset.scheduleText === text && target.children.length) return;
  target.dataset.scheduleText = text;
  const [heading, timing, ...event] = text.split(' · '), parts = [heading, timing, event.join(' · ')].filter(Boolean);
  target.replaceChildren(...parts.flatMap((value, index) => {
    const span = doc.createElement('span'); span.className = ['network-title', 'network-timing', 'network-event'][index]; span.textContent = value;
    if (!index) return [span];
    const divider = doc.createElement('span'); divider.className = 'schedule-divider'; divider.textContent = ' · ';
    return [divider, span];
  }));
}
// Catalog game timing in browse lists. A catalog time is never upgraded to confirmed here: browsing
// reads no fresh status. A date-only game shows its calendar date (read in UTC so it never shifts).
export function browseWhen(game) {
  if (Number.isFinite(game?.start)) return `${new Date(game.start).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (unconfirmed)`;
  const m = typeof game?.date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(game.date) : null;
  if (m) return `${new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} · Time TBD`;
  return 'Date not announced';
}
const weekLabel = week => {
  const day = at => new Date(at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `This week · ${day(week.start)} – ${day(week.end - 43_200_000)}`;
};
// How long a listed game stays offered for listening after its catalog start.
const RECENT_MS = 12 * 3600_000;
export function setupViews({ doc, navigate, snapshot, selectSource, play, shell, listen = () => {}, prefs = null, browse = null, onScreen = () => {}, now = () => Date.now() }) {
  const $ = id => doc.getElementById(id);
  let screen = 'home', previous = 'home', browsed = null, lastTeams = '', lastGames = '', lastSources = '', lastHistory = null, lastTeam = '', lastSchedule = '';
  for (const id of ['live-panel', 'archive-panel']) { $(id).removeAttribute('role'); $(id).removeAttribute('aria-labelledby'); }
  doc.querySelector('.player-identity').append($('feed-picker'));
  $('live-panel').append($('player-details'));
  doc.querySelector('.player-screen .selectors').append($('game-refresh'));
  // The game choice stays directly on the Player, right under Team, instead of inside a disclosure.
  doc.querySelector('.player-screen .selectors').after($('game-panel'));
  const routes = ['home', 'teams', 'team', 'schedule', 'streams', 'player', 'history', 'recordings', 'more'];
  const panelOf = name => $(name === 'player' ? 'live-panel' : name === 'recordings' ? 'archive-panel' : `${name}-view`);
  // Runs only after any departure prompt has been accepted; a canceled navigation never reaches it.
  function commit(next, focus = true) {
    screen = next; doc.body.dataset.screen = next;
    if (next !== 'more') previous = next;
    for (const name of routes) { const el = panelOf(name); if (el) el.hidden = name !== next; }
    for (const button of doc.querySelectorAll('.main-nav [data-route]')) {
      const current = button.dataset.route === next || (next === 'team' && button.dataset.route === 'teams');
      if (current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    $('more').setAttribute('aria-current', next === 'more' ? 'page' : 'false');
    // More toggles: while it is open the same button closes it and returns to the previous screen.
    $('more').setAttribute('aria-label', next === 'more' ? 'Close More' : 'More');
    if ($('more').lastChild?.nodeType === 3) $('more').lastChild.textContent = next === 'more' ? ' Close' : ' More';
    try { onScreen(next, browsed); } catch { /* Appearance never blocks navigation. */ }
    update();
    if (next === 'schedule') loadWeek();
    if (next === 'team') loadTeamGames();
    if (focus) {
      const heading = panelOf(next)?.querySelector('h1, h2');
      heading?.setAttribute('tabindex', '-1'); heading?.focus();
    }
  }
  function go(next, options = {}) { if (routes.includes(next)) navigate(next, () => commit(next), options); }
  function openTeam(key) { browsed = key; lastTeam = ''; go('team'); }
  doc.addEventListener('click', event => {
    const target = event.target.closest?.('[data-route], [data-tool]');
    if (!target) return;
    if (target.dataset.route) go(target.dataset.route);
    else { $(target.dataset.tool)?.click(); }
  });
  $('more').onclick = () => go(screen === 'more' ? previous : 'more');
  $('more').removeAttribute('aria-haspopup'); $('more').removeAttribute('aria-expanded'); $('more').removeAttribute('aria-controls');
  $('owner-return').onclick = () => go('player');
  $('home-match').onclick = () => { go('player'); $('match-toggle').click(); };
  $('streams-auto').onclick = () => selectSource('auto');
  $('more-reconnect').onclick = () => $('menu-reconnect').click();
  $('more-install').onclick = () => { if (!shell.homeScreen?.open()) { $('more-install').querySelector('span').textContent = 'Installation help is unavailable in this display mode.'; } };
  function row(title, detail, action, badge = null) {
    const el = doc.createElement('div'); el.className = 'list-row';
    const text = doc.createElement('div'), strong = doc.createElement('strong'), small = doc.createElement('span');
    strong.textContent = title; small.textContent = detail; text.append(strong, small); el.append(text);
    if (badge) { const img = doc.createElement('img'); img.src = badge; img.alt = ''; el.prepend(img); }
    if (action) { const button = doc.createElement('button'); button.textContent = action.label; button.setAttribute('aria-label', `${action.label} ${title}`);
      if (action.current) el.classList.add('is-current');
      button.disabled = !!action.disabled; button.onclick = action.run; el.append(button); }
    return el;
  }
  // Keyed rows retain their action nodes across selection and background label updates.
  // A just-committed choice becomes disabled, so focus moves to its stable row label.
  function syncRows(target, entries) {
    const focused = target.contains(doc.activeElement) ? doc.activeElement : null;
    const focusedRow = focused?.closest('.list-row');
    const keyed = new Map([...target.children].map(el => [el.dataset.key, el]));
    const keep = new Set();
    for (const [index, entry] of entries.entries()) {
      let el = keyed.get(entry.key);
      if (el && !!el.querySelector('button') !== !!entry.action) { el.remove(); el = null; }
      if (!el) { el = row(entry.title, entry.detail, entry.action, entry.badge); el.dataset.key = entry.key; }
      const strong = el.querySelector('strong'), small = el.querySelector('span'), button = el.querySelector('button'), img = el.querySelector('img');
      if (strong.textContent !== entry.title) strong.textContent = entry.title;
      if (small.textContent !== entry.detail) small.textContent = entry.detail;
      if (img && img.getAttribute('src') !== entry.badge) img.src = entry.badge;
      el.classList.toggle('is-current', !!entry.action?.current);
      if (button) {
        if (button.textContent !== entry.action.label) button.textContent = entry.action.label;
        button.setAttribute('aria-label', `${entry.action.label} ${entry.title}`);
        button.disabled = !!entry.action.disabled; button.onclick = entry.action.run;
      }
      if (target.children[index] !== el) target.insertBefore(el, target.children[index] ?? null);
      keep.add(el);
    }
    for (const el of [...target.children]) if (!keep.has(el)) el.remove();
    if (focused && !target.closest('[hidden]')) {
      const destination = focusedRow?.isConnected ? focused.disabled ? focusedRow.querySelector('strong') : focused : target.closest('section')?.querySelector('h1, h2');
      if (!destination) return;
      if (destination !== focused) destination.setAttribute('tabindex', '-1');
      if (doc.activeElement !== destination) destination.focus();
    }
  }
  function histories(list, target, limit = Infinity) {
    target.replaceChildren(...list.slice(0, limit).map(item => row(item.title, `${item.source} · ${new Date(item.at).toLocaleString()}`)));
    if (!list.length) { const p = doc.createElement('p'); p.className = 'hint empty-state'; p.textContent = 'No listening history yet. Played audio will appear here on this device.'; target.append(p); }
  }
  const fullName = team => `${team.name} ${teams[team.key]?.nickname ?? ''}`.trim();
  const networkOf = team => (team?.radio ? teams[team.key]?.station ?? 'Network stream' : null);
  const playerBusy = s => !!s.active;
  // Row truth comes from the actual playing candidate, never from the selected team or game alone.
  const playingNetwork = (s, key) => s.playing?.team === key && s.playing.kind === 'network' && s.playing.sourceId === teams[key]?.sourceId;
  const playingGame = (s, key, id) => s.playing?.team === key && s.playing.kind === 'game' && s.playing.gameId === id;

  // ---------- First-visit favorite prompt (issue #59) ----------
  function chooseFavorite(key) {
    prefs?.setFavorite(key);
    closeDialog($('favorite-dialog'));
    update();
  }
  function skipFavorite() { prefs?.skip(); closeDialog($('favorite-dialog')); update(); }
  function promptFavorite() {
    const s = snapshot(); if (!s || !prefs) return;
    $('favorite-list').replaceChildren(...s.teams.map(team => {
      const button = doc.createElement('button'), img = doc.createElement('img'), label = doc.createElement('span');
      img.src = s.artFor(team.name); img.alt = ''; label.textContent = team.label;
      button.append(img, label); button.dataset.team = team.key;
      if (team.key === prefs.favorite) button.setAttribute('aria-pressed', 'true');
      button.onclick = () => chooseFavorite(team.key);
      return button;
    }));
    openDialog($('favorite-dialog'));
  }
  $('favorite-skip').onclick = skipFavorite;
  // Escape or a platform close request is an answer too: Skip, so the prompt never repeats.
  onDismiss($('favorite-dialog'), skipFavorite);
  $('home-choose').onclick = promptFavorite;

  // ---------- Home: the favorite, honest about what the Player is doing ----------
  function renderHome(s) {
    const key = prefs?.favorite ?? null, favorite = key ? s.teams.find(team => team.key === key) ?? null : null;
    const same = !!key && key === s.team.key, busy = playerBusy(s);
    const playing = `${s.source?.station ?? s.team.name} · ${s.status}`;
    $('home-choose').hidden = !!key; $('home-browse').hidden = !!key;
    $('home-match').hidden = !same;
    $('home-game-card').hidden = !same;
    $('home-mode').hidden = !same;
    if (!key) {
      $('home-eyebrow').textContent = 'No favorite team yet';
      $('home-title').textContent = 'Pick your team';
      $('home-art').src = s.artFor('');
      $('home-source').textContent = busy ? `Now playing: ${playing}` : 'Home follows the team you star. Every team stays one tap away in Teams and Schedule.';
      $('home-play').hidden = true;
      $('home-open').hidden = !busy;
      $('home-mismatch').textContent = '';
    } else if (same) {
      $('home-eyebrow').textContent = '★ Your team';
      $('home-title').textContent = fullName(s.team);
      $('home-art').src = s.art;
      $('home-source').textContent = playing;
      $('home-mode').textContent = `Source: ${s.mode}`;
      $('home-mismatch').textContent = s.mismatch;
      $('home-play').hidden = false; $('home-open').hidden = false;
      $('home-play').disabled = s.playDisabled;
      $('home-play').textContent = busy ? 'Open playing audio' : s.playLabel;
      $('home-play').onclick = busy ? () => go('player') : () => listen(s.team.key);
      $('home-game').textContent = s.gameLabel?.replace(/ · feed not published$/, '') || 'No game selected';
    } else {
      const name = favorite?.name ?? 'Your favorite team';
      $('home-eyebrow').textContent = '★ Your team';
      $('home-title').textContent = favorite ? fullName(favorite) : name;
      $('home-art').src = s.artFor(favorite?.name ?? '');
      $('home-source').textContent = favorite ? networkOf(favorite) ?? `${favorite.name} game feeds when posted` : 'This team isn’t listed by the game catalog right now.';
      // The Player belongs to another team; say so instead of borrowing its status.
      $('home-mismatch').textContent = busy ? `${s.source?.station ?? s.team.name} is playing in the Player (${s.status}). Listening to ${name} stops it after you confirm.` : `The Player is set to ${s.team.label ?? s.team.name}.`;
      $('home-play').hidden = false; $('home-open').hidden = !busy;
      $('home-play').disabled = !favorite;
      $('home-play').textContent = `Listen to ${favorite?.label ?? name}`;
      $('home-play').onclick = () => listen(key);
    }
    for (const target of doc.querySelectorAll('[data-schedule-copy], #broadcast-next')) renderNetworkSchedule(doc, target, target.id === 'home-network' && !same ? '' : s.schedule);
  }

  // ---------- Team page (issue #68): read-only browse of one school ----------
  let teamLoad = null, teamGames = { key: null, state: 'idle', games: [] };
  async function loadTeamGames(fresh = false) {
    const s = snapshot(), team = s?.teams.find(t => t.key === browsed);
    teamLoad?.abort(); teamLoad = null;
    if (!team?.catalogId || !browse) { teamGames = { key: browsed, state: 'none', games: [] }; renderTeam(s, true); return; }
    if (!fresh && teamGames.key === team.key && teamGames.state === 'ready') { renderTeam(s, true); return; }
    const controller = teamLoad = new AbortController();
    teamGames = { key: team.key, state: 'loading', games: [] }; renderTeam(s, true);
    try {
      const games = await browse.games(team.catalogId, { signal: controller.signal, fresh });
      if (controller.signal.aborted || browsed !== team.key) return;
      teamGames = { key: team.key, state: 'ready', games };
    } catch {
      if (controller.signal.aborted || browsed !== team.key) return;
      teamGames = { key: team.key, state: 'failed', games: [] };
    }
    if (teamLoad === controller) teamLoad = null;
    renderTeam(snapshot(), true);
  }
  $('team-games-refresh').onclick = () => loadTeamGames(true);
  $('team-star').onclick = () => {
    if (!prefs || !browsed) return;
    const starred = prefs.favorite === browsed;
    const saved = prefs.setFavorite(starred ? null : browsed);
    const s = snapshot(), team = s.teams.find(t => t.key === browsed);
    $('team-star-note').textContent = (starred ? 'No favorite team. Home will invite you to choose one.' : `${team?.name ?? 'This team'} is your Home team.`) + (saved ? '' : ' It could not be saved on this browser.');
    lastTeam = ''; update();
  };
  $('team-recordings').onclick = () => { if (browsed) go('recordings', { school: browsed }); };
  function renderTeam(s, force = false) {
    if (!s || !browsed) return;
    const team = s.teams.find(t => t.key === browsed) ?? null, key = browsed;
    const inPlayer = key === s.team.key, busy = playerBusy(s), starred = prefs?.favorite === key;
    const signature = JSON.stringify([key, !!team, starred, inPlayer, busy, s.status, s.games, s.playing, teamGames.state, teamGames.key, s.recordings]);
    if (!force && signature === lastTeam) return;
    lastTeam = signature;
    if (!team) {
      $('team-title').textContent = 'Team not listed'; $('team-subtitle').textContent = 'This school isn’t listed by the game catalog right now.';
      for (const id of ['team-live', 'team-games']) $(id).replaceChildren();
      return;
    }
    $('team-art').src = s.artFor(team.name);
    $('team-title').textContent = fullName(team);
    const network = networkOf(team);
    $('team-subtitle').textContent = [network, team.catalogId ? 'Game feeds when posted' : null, inPlayer ? 'In the Player' : null].filter(Boolean).join(' · ');
    $('team-star').textContent = starred ? '★ Favorite' : '☆ Favorite';
    $('team-star').setAttribute('aria-pressed', String(starred));
    $('team-star').setAttribute('aria-label', `Favorite ${team.name}`);
    if (!prefs) $('team-star').hidden = true;
    // Listen live: the configured network, or an honest note when there is none.
    const official = s.officialFor?.(key) ?? null;
    const live = [];
    const networkNow = playingNetwork(s, key);
    if (network) live.push({ key: 'network', title: network, detail: networkNow ? `In the Player · ${s.status}` : 'Live network stream · it may carry other programming',
      action: networkNow ? { label: 'Open player', run: () => go('player') } : { label: 'Listen', run: () => listen(key, null, 'network') } });
    syncRows($('team-live'), live);
    if (official) {
      const link = doc.createElement('a'); link.className = 'button-link'; link.href = official; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Official player ↗';
      $('team-live').append(link);
    }
    $('team-live-note').textContent = network
      ? team.catalogId ? '' : `Homecall has no dedicated game-feed schedule for ${team.name}. The network stream is live radio; check the official player for game coverage.`
      : `No network stream is configured for ${team.name} in Homecall. Live audio is available when a game feed is posted below.`;
    // Game feeds: published catalog listings only, newest-relevant first; nothing is invented.
    const refresh = $('team-games-refresh');
    if (!team.catalogId) {
      $('team-games-note').textContent = `No game feeds are listed for ${team.name}.`; $('team-games').replaceChildren(); refresh.hidden = true;
    } else if (teamGames.key !== key || teamGames.state === 'loading' || teamGames.state === 'idle') {
      $('team-games-note').textContent = `Loading ${team.name} games…`; refresh.hidden = true;
    } else if (teamGames.state === 'failed') {
      $('team-games-note').textContent = 'The game list could not load. Refresh to retry.'; $('team-games').replaceChildren(); refresh.hidden = false;
    } else {
      const t = now();
      const upcoming = teamGames.games.filter(g => !Number.isFinite(g.start) || g.start > t - RECENT_MS)
        .sort((a, b) => (Number.isFinite(a.start) ? a.start : Infinity) - (Number.isFinite(b.start) ? b.start : Infinity));
      const earlier = teamGames.games.length - upcoming.length;
      $('team-games-note').textContent = !teamGames.games.length ? `No ${team.name} games are listed right now.`
        : `${upcoming.length ? '' : `No upcoming ${team.name} games are listed. `}${earlier ? `${earlier} earlier ${earlier === 1 ? 'game is' : 'games are'} in the Player’s game list.` : ''}`.trim();
      syncRows($('team-games'), upcoming.map(game => {
        const playingThis = playingGame(s, key, game.id);
        return { key: game.id, title: `vs ${game.opponent}`, detail: `${browseWhen(game)} · ${game.url ? 'Feed posted' : 'Feed not posted yet'}`,
          action: playingThis ? { label: 'Open player', run: () => go('player') } : game.url ? { label: 'Listen', run: () => listen(key, game.id, 'game') } : null };
      }));
      refresh.hidden = false;
    }
    // Recordings: only schools the archive actually covers; never another school's list.
    const covered = (s.recordings ?? []).includes(key);
    $('team-recordings').hidden = !covered;
    $('team-recordings').textContent = `Open ${team.name} recordings ›`;
    $('team-recordings-note').textContent = covered ? 'Full broadcasts, no scores.' : `In-app recordings aren’t provided for ${team.name}.${official ? ' The official site may have archives.' : ''}`;
  }

  // ---------- Weekly Schedule (issue #68): every catalog school, current local Monday–Sunday ----------
  let weekLoad = null, weekState = { state: 'idle', result: null, at: 0, signature: '' };
  const catalogSchools = s => s.teams.filter(team => team.catalogId).map(team => ({ key: team.key, name: team.name, catalogId: team.catalogId }));
  async function loadWeek(fresh = false) {
    const s = snapshot(); if (!s || !browse) return;
    const schools = catalogSchools(s), signature = JSON.stringify([schools.map(school => school.key), currentWeek(now()).first]);
    if (!fresh && weekState.signature === signature && (weekState.state === 'loading' || (weekState.state === 'ready' && now() - weekState.at < 5 * 60_000))) { renderSchedule(s, true); return; }
    weekLoad?.abort();
    const controller = weekLoad = new AbortController();
    weekState = { state: 'loading', result: weekState.result, at: 0, signature }; renderSchedule(s, true);
    try {
      const result = await browse.week(schools, { signal: controller.signal, fresh });
      if (controller.signal.aborted) return;
      weekState = { state: 'ready', result, at: now(), signature };
    } catch {
      if (controller.signal.aborted) return;
      weekState = { state: 'failed', result: null, at: 0, signature };
    }
    if (weekLoad === controller) weekLoad = null;
    renderSchedule(snapshot(), true);
  }
  // Read-only: this reloads browse lists only, never the Player's catalog, game or audio.
  $('schedule-refresh').onclick = () => loadWeek(true);
  function renderSchedule(s, force = false) {
    if (!s) return;
    const week = weekState.result?.week ?? currentWeek(now());
    const signature = JSON.stringify([weekState.state, weekState.at, s.playing, s.teams.map(team => team.key)]);
    if (!force && signature === lastSchedule) return;
    lastSchedule = signature;
    $('schedule-subtitle').textContent = weekLabel(week);
    $('schedule-refresh').disabled = weekState.state === 'loading';
    const result = weekState.result;
    if (weekState.state === 'loading' && !result) $('schedule-note').textContent = 'Loading this week’s games…';
    else if (weekState.state === 'failed' || (result && result.schools && result.failed.length === result.schools)) $('schedule-note').textContent = 'The game catalog could not load. Refresh to retry.';
    else if (result) {
      const count = result.entries.length;
      $('schedule-note').textContent = `${count ? `${count} ${count === 1 ? 'game' : 'games'} with game-feed listings this week.` : 'No games with game-feed listings this week.'} Times come from the game catalog and may change.` +
        (result.failed.length ? ` Couldn’t load ${result.failed.join(', ')}; refresh to retry.` : '') + (weekState.state === 'loading' ? ' Refreshing…' : '');
    }
    const days = new Map();
    for (const entry of weekState.state === 'failed' ? [] : result?.entries ?? []) {
      const day = entry.placement === 'timed' ? new Date(entry.game.start) : new Date(`${entry.game.date}T00:00:00`);
      const label = day.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
      if (!days.has(label)) days.set(label, []);
      days.get(label).push(entry);
    }
    $('schedule-list').replaceChildren(...[...days].flatMap(([label, entries]) => {
      const heading = doc.createElement('h3'); heading.className = 'day-heading'; heading.textContent = label;
      return [heading, ...entries.map(entry => {
        const { game } = entry, team = s.teams.find(t => t.key === entry.key);
        const when = entry.placement === 'timed' ? `${new Date(game.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (unconfirmed)` : 'Time TBD';
        const playingThis = playingGame(s, entry.key, game.id);
        const action = playingThis ? { label: 'Open player', run: () => go('player') } : game.url ? { label: 'Listen', run: () => listen(entry.key, game.id, 'game') } : { label: 'Team', run: () => openTeam(entry.key) };
        const el = row(`${team?.label ?? entry.school} vs ${game.opponent}`, `${when} · ${entry.school} game feed ${game.url ? 'posted' : 'not posted yet'}`, action, s.artFor(entry.school));
        el.dataset.key = `${entry.key}:${game.id}`;
        return el;
      })];
    }));
    const undated = weekState.state === 'failed' ? [] : result?.undated ?? [];
    $('schedule-undated').hidden = !undated.length;
    $('schedule-undated').textContent = undated.length ? `Date not announced, so not shown for this week: ${undated.slice(0, 5).map(entry => `${entry.school} vs ${entry.game.opponent}`).join('; ')}${undated.length > 5 ? `; ${undated.length - 5} more` : ''}.` : '';
    // Network-only schools have live radio but no game-feed schedule; send them to their Team page.
    const networkOnly = s.teams.filter(team => team.radio && !team.catalogId);
    $('schedule-network-title').hidden = !networkOnly.length;
    $('schedule-coverage').textContent = networkOnly.length ? 'These schools have live network radio but no game-feed schedule in Homecall.' : '';
    syncRows($('schedule-network'), networkOnly.map(team => ({ key: team.key, title: team.label, detail: networkOf(team), action: { label: 'Open', run: () => openTeam(team.key) }, badge: s.artFor(team.name) })));
  }

  function update() {
    const s = snapshot(); if (!s) return;
    renderHome(s);
    $('player-game').textContent = s.gameTitle || s.team.name;
    $('player-game-meta').textContent = s.gameMeta;
    // Streams is the committed Player team's source list, named plainly; Team pages do the browsing.
    $('streams-subtitle').textContent = `Player sources · ${s.team.label ?? s.team.name}`;
    $('streams-scope').textContent = `These are the sources for the team in the Player. To listen to another team, open it in Teams or Schedule.`;
    $('streams-school').textContent = `${s.team.name} sources`;
    $('streams-mode').textContent = s.mode === 'Automatic' ? 'Automatic · tries the game feed, then available network sources and backups' : `Manual · ${s.mode}`;
    $('streams-auto').hidden = s.mode === 'Automatic';
    $('streams-note').textContent = s.sourceNote;
    const warning = /could not|couldn’t|more than one|no live or upcoming|no longer listed/i.test(s.gameNote) ? s.gameNote : '';
    $('player-catalog-note').textContent = $('home-catalog-note').textContent = warning;
    for (const id of ['streams-official', 'more-official']) { $(id).hidden = !s.official; if (s.official) $(id).href = s.official; }
    $('more-reconnect').disabled = s.reconnectDisabled;
    if (s.history !== lastHistory) { lastHistory = s.history; const history = listeningHistory(s.history); histories(history, $('history-list')); histories(history, $('home-history'), 2); }
    const favorite = prefs?.favorite ?? null;
    const teamsSignature = JSON.stringify([s.team.key, s.teams, favorite]);
    if (teamsSignature !== lastTeams) {
      lastTeams = teamsSignature;
      syncRows($('team-list'), s.teams.map(team => ({ key: team.key, title: team.label,
        detail: [team.key === favorite ? '★ Favorite' : null, networkOf(team) ?? 'Game feeds when posted', team.key === s.team.key ? 'In the Player' : null].filter(Boolean).join(' · '),
        action: { label: 'Open', current: team.key === favorite, run: () => openTeam(team.key) }, badge: s.artFor(team.name) })));
    }
    const sourcesSignature = JSON.stringify([s.sources, s.art]);
    if (sourcesSignature !== lastSources) {
      lastSources = sourcesSignature;
      syncRows($('streams-list'), s.sources.map(source => ({ key: source.id, title: source.label, detail: source.selected ? 'Chosen in Source' : source.description, action: { label: source.selected ? '✓ Selected' : 'Choose', current: source.selected, disabled: source.disabled || source.selected, run: () => selectSource(source.id) }, badge: s.art })));
    }
    const gamesSignature = JSON.stringify(s.games);
    if (gamesSignature !== lastGames) { lastGames = gamesSignature; lastTeam = ''; lastSchedule = ''; }
    if (screen === 'team') renderTeam(s);
    if (screen === 'schedule') {
      // A school the catalog added after the week loaded joins on the next look, without polling.
      if (weekState.signature && weekState.signature !== JSON.stringify([catalogSchools(s).map(school => school.key), currentWeek(now()).first]) && weekState.state !== 'loading') loadWeek();
      else renderSchedule(s);
    }
  }
  // The countdown and game-status controllers keep their own cadence. Observe their presentation,
  // never introduce another poll/fetch/state owner. Do not observe derived view nodes.
  const observer = new doc.defaultView.MutationObserver(update);
  for (const id of ['broadcast-next', 'game', 'game-note']) observer.observe($(id), { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
  commit('home', false);
  // Ask once on a first visit; a skipped or chosen answer is remembered and never asks again.
  if (prefs && !prefs.answered) promptFavorite();
  return { go, commit, update, openTeam, promptFavorite, get screen() { return screen; }, get browsed() { return browsed; } };
}
