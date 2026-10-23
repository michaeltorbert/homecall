// Presentation only. Persistent controls and their guarded handlers remain the state owners.
import { teams, catalogTeams, getSources } from './teams.js';
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
export function setupViews({ doc, navigate, snapshot, selectTeam, selectSource, play, shell }) {
  const $ = id => doc.getElementById(id);
  let screen = 'home', lastTeams = '', lastGames = '', lastSources = '', lastHistory = null;
  for (const id of ['live-panel', 'archive-panel']) { $(id).removeAttribute('role'); $(id).removeAttribute('aria-labelledby'); }
  doc.querySelector('.player-identity').append($('feed-picker'));
  $('live-panel').append($('player-details'));
  doc.querySelector('.player-screen .selectors').append($('game-refresh'));
  $('player-details-content').prepend($('game-panel'));
  const routes = ['home', 'teams', 'schedule', 'streams', 'player', 'history', 'recordings', 'more'];
  function commit(next, focus = true) {
    screen = next; doc.body.dataset.screen = next;
    for (const name of routes) {
      const el = $(name === 'player' ? 'live-panel' : name === 'recordings' ? 'archive-panel' : `${name}-view`);
      if (el) el.hidden = name !== next;
    }
    for (const button of doc.querySelectorAll('.main-nav [data-route]')) {
      if (button.dataset.route === next) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    $('more').setAttribute('aria-current', next === 'more' ? 'page' : 'false');
    update();
    if (focus) {
      const panel = $(next === 'player' ? 'live-panel' : next === 'recordings' ? 'archive-panel' : `${next}-view`);
      const heading = panel?.querySelector('h1, h2');
      heading?.setAttribute('tabindex', '-1'); heading?.focus();
    }
  }
  function go(next) { if (routes.includes(next)) navigate(next, () => commit(next)); }
  doc.addEventListener('click', event => {
    const target = event.target.closest?.('[data-route], [data-tool]');
    if (!target) return;
    if (target.dataset.route) go(target.dataset.route);
    else { $(target.dataset.tool)?.click(); }
  });
  $('more').onclick = () => go('more');
  $('more').removeAttribute('aria-haspopup'); $('more').removeAttribute('aria-expanded'); $('more').removeAttribute('aria-controls');
  $('owner-return').onclick = () => go('player');
  $('home-play').onclick = () => { go('player'); play(); };
  $('home-match').onclick = () => { go('player'); $('match-toggle').click(); };
  for (const id of ['schedule-refresh', 'more-refresh']) $(id).onclick = () => { go('player'); $('game-refresh').click(); };
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
      if (!el) { el = row(entry.title, entry.detail, entry.action, entry.badge); el.dataset.key = entry.key; }
      const strong = el.querySelector('strong'), small = el.querySelector('span'), button = el.querySelector('button'), img = el.querySelector('img');
      if (strong.textContent !== entry.title) strong.textContent = entry.title;
      if (small.textContent !== entry.detail) small.textContent = entry.detail;
      if (img && img.getAttribute('src') !== entry.badge) img.src = entry.badge;
      el.classList.toggle('is-current', !!entry.action.current);
      if (button.textContent !== entry.action.label) button.textContent = entry.action.label;
      button.setAttribute('aria-label', `${entry.action.label} ${entry.title}`);
      button.disabled = !!entry.action.disabled; button.onclick = entry.action.run;
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
  function update() {
    const s = snapshot(); if (!s) return;
    $('home-title').textContent = `${s.team.name} ${teams[s.team.key]?.nickname ?? ''}`.trim();
    $('home-art').src = s.art;
    $('home-source').textContent = `${s.source?.station ?? s.team.name} · ${s.status}`;
    $('home-mode').textContent = `Source: ${s.mode}`;
    $('home-mismatch').textContent = s.mismatch;
    $('home-game').textContent = s.gameLabel?.replace(/ · feed not published$/, '') || 'No game selected';
    $('player-game').textContent = s.gameTitle || s.team.name;
    $('player-game-meta').textContent = s.gameMeta;
    $('home-play').disabled = s.playDisabled;
    $('home-play').textContent = s.active ? 'Open playing audio' : s.playLabel;
    $('home-play').onclick = s.active ? () => go('player') : () => { go('player'); play(); };
    $('schedule-subtitle').textContent = `${s.team.name} games`;
    $('schedule-school').textContent = `${s.team.name} games`;
    $('streams-subtitle').textContent = `What ${s.team.name} can play now`;
    $('streams-school').textContent = `${s.team.name} sources`;
    $('streams-mode').textContent = s.mode === 'Automatic' ? 'Automatic · tries the game feed, then available network sources and backups' : `Manual · ${s.mode}`;
    $('streams-auto').hidden = s.mode === 'Automatic';
    $('streams-note').textContent = s.sourceNote;
    $('schedule-note').textContent = s.gameNote;
    const warning = /could not|couldn’t|more than one|no live or upcoming|no longer listed/i.test(s.gameNote) ? s.gameNote : '';
    $('player-catalog-note').textContent = $('home-catalog-note').textContent = warning;
    for (const id of ['streams-official', 'more-official']) { $(id).hidden = !s.official; if (s.official) $(id).href = s.official; }
    $('more-reconnect').disabled = s.reconnectDisabled;
    $('schedule-refresh').disabled = $('more-refresh').disabled = s.refreshDisabled || s.noCatalog;
    for (const target of doc.querySelectorAll('[data-schedule-copy], #broadcast-next')) renderNetworkSchedule(doc, target, s.schedule);
    if (s.history !== lastHistory) { lastHistory = s.history; const history = listeningHistory(s.history); histories(history, $('history-list')); histories(history, $('home-history'), 2); }
    const teamsSignature = JSON.stringify([s.team.key, s.teams]);
    if (teamsSignature !== lastTeams) {
      lastTeams = teamsSignature;
      syncRows($('team-list'), s.teams.map(team => ({ key: team.key, title: team.label, detail: team.radio ? teams[team.key]?.station ?? 'Network stream' : 'Game feeds when posted', action: { label: team.key === s.team.key ? '✓ Your team' : 'Choose', current: team.key === s.team.key, disabled: team.key === s.team.key, run: () => selectTeam(team.key) }, badge: s.artFor(team.name) })));
    }
    const gamesSignature = JSON.stringify(s.games);
    if (gamesSignature !== lastGames) {
      lastGames = gamesSignature;
      syncRows($('schedule-list'), s.games.map(game => ({ key: game.id, title: game.label, detail: game.selected ? 'Selected game' : 'Choose to check its feed', action: { label: game.selected ? '✓ Selected' : 'Select', current: game.selected, disabled: game.disabled || game.selected, run: () => { $('game').value = game.id; $('game').onchange(); } } })));
    }
    const sourcesSignature = JSON.stringify([s.sources, s.art]);
    if (sourcesSignature !== lastSources) {
      lastSources = sourcesSignature;
      syncRows($('streams-list'), s.sources.map(source => ({ key: source.id, title: source.label, detail: source.selected ? 'Chosen in Source' : source.description, action: { label: source.selected ? '✓ Selected' : 'Choose', current: source.selected, disabled: source.disabled || source.selected, run: () => selectSource(source.id) }, badge: s.art })));
    }
  }
  // The countdown and game-status controllers keep their own cadence. Observe their presentation,
  // never introduce another poll/fetch/state owner. Do not observe derived view nodes.
  const observer = new doc.defaultView.MutationObserver(update);
  for (const id of ['broadcast-next', 'game', 'game-note']) observer.observe($(id), { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
  commit('home', false);
  return { go, commit, update, get screen() { return screen; } };
}
