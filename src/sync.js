import { browserTiming } from './timing-transport.js';
import { createTimingFreshness, nextPollDelay } from './timing-freshness.js';
import { metadataURL } from './gateway.js';
import { readJSON } from './homestream.js';
import { setupHomestream } from './homestream-ui.js';
import { createGameStatus } from './game-status.js';
import { SyncPlayer } from './sync-player.js';
import { schoolKey, footballSeason, matchEvent, availableAnchors, selectAnchors, gameOrder, playLabel } from './sync-mapping.js';
const CHOOSE_SOURCE = 'Choose a timing source to find a play by TV clock. Manual adjustments work without it.';
export function setupSync({ initialSchool = () => 'Duke', stopLive = () => {}, liveActive = () => false, confirm = null, nowPlaying = null, scoreboard = null } = {}) {
  const $ = id => document.getElementById(`sync-${id}`);
  // Prompts before a takeover or a stop; with nothing to confirm (or no prompt host) the original action runs directly.
  const ask = (options, proceed, revert) => { if (!confirm || !options) return proceed(); revert?.(); confirm.ask(options, proceed); };
  // A reconnect moves the HLS timeline: old play choices expire; offset, calibration and timing source stay.
  // It also invalidates the Now Playing scoreboard without forgetting the session; a terminal stop releases it.
  // Recovery warnings (reconnecting, terminal stop, unverified-position fallback) are flagged for the
  // modal warning mirrors. The flag lasts while the player keeps showing that same warning text;
  // any later status (playing, paused, buffering, Stop) replaces it and clears the flag.
  let alertText = null;
  const flag = on => { alertText = on ? $('playback').textContent : null; $('playback').dataset.alert = on ? 'on' : ''; };
  const audio = $('audio'), player = new SyncPlayer(audio, text => { $('playback').textContent = text; if (alertText !== null && text !== alertText) flag(false); }, { onRecovery: event => {
    if (event?.type === 'stopped') release(); else if (event?.type === 'reconnecting') scoreboard?.invalidate();
    // Terminal stops and recovery replacement also invalidate stale prompts about this session.
    const replaced = event?.type === 'stopped' || event?.type === 'reconnecting';
    flag(replaced || event?.type === 'fallback');
    if (replaced) confirm?.cancel();
    clearChoices(); render();
  } });
  let active = false, teamsController, mappingController, pollTimer, plays = [], conflict = false, calibrationKey = null, selectionKey = null, snapshot = 0, timingReady = false;
  let owner = null, statusCatalog = null, unsupported = false, committedTeam = '';
  function release() { scoreboard?.stop(); owner?.release(); owner = null; }
  // Claimed before player.start, which can synchronously report a terminal stop.
  function claim(game) {
    release();
    if (!nowPlaying) return;
    const mine = owner = nowPlaying.claim({ mode: 'sync', school: school(), opponent: game.opponent });
    if (statusCatalog && nowPlaying.supported) scoreboard?.start({ teamId: statusCatalog.teamId, school: school(), game, games: statusCatalog.games,
      eligible: () => owner === mine && mine.current && player.active && !audio.paused && !audio.ended, onUpdate: value => mine.update(value) });
  }
  // Additive listeners: the player owns the audio element's on* handlers.
  for (const type of ['playing', 'pause', 'ended', 'emptied']) audio.addEventListener(type, () => scoreboard?.check());
  const api = path => metadataURL(path, document.baseURI, typeof __GATEWAY_ORIGIN__ === 'string' ? __GATEWAY_ORIGIN__ : '', { allowLocal: typeof __GATEWAY_ALLOW_LOCAL__ === 'boolean' && __GATEWAY_ALLOW_LOCAL__ });
  const freshness = createTimingFreshness();
  // Timing source starts unset; choosing one never moves or restarts audio.
  const retry = $('timing-retry'), source = $('timing-source');
  source.onchange = () => { calibrationKey = null; $('offset').value = '0'; clearMapping(); if (active && catalog.ready) void loadMapping(catalog.ready); render(); };
  retry.onclick = () => { if (active && catalog.ready) void loadMapping(catalog.ready); };
  const school = () => $('team').selectedOptions[0]?.textContent || initialSchool();
  const offset = () => { const n = Number($('offset').value); return Number.isFinite(n) ? n : 0; };
  const canSeek = () => player.active && timingReady && (source.value === 'browser' || freshness.fresh());
  // Invalidated choices also take their own "choose a play" invitation with them; any newer
  // feedback (nudge, incoming, seek result or error) has replaced that text and stays.
  let invitation = null;
  function clearChoices() {
    snapshot++; $('matches').replaceChildren();
    if (invitation !== null && $('result').textContent === invitation) $('result').textContent = '';
    invitation = null;
  }
  function clearMapping() {
    mappingController?.abort(); mappingController = null; clearTimeout(pollTimer);
    plays = []; timingReady = false; unsupported = false; freshness.invalidate(); conflict = false; clearChoices(); retry.hidden = true;
    $('mapping-note').textContent = source.value ? 'Waiting for game timing data.' : CHOOSE_SOURCE;
  }
  function reset() {
    release(); player.stop(); clearMapping(); $('playback').textContent = 'Stopped.'; flag(false);
    $('result').textContent = ''; render();
  }
  async function loadMapping(game) {
    clearMapping();
    if (!active || document.visibilityState === 'hidden') return;
    if (!source.value) return;
    const controller = mappingController = new AbortController(), signal = controller.signal;
    const transport = source.value;
    const timingRead = path => transport === 'browser' ? browserTiming(path, {signal}) : readJSON(api(path), {signal});
    $('mapping-note').textContent = 'Finding matching game timing…';
    try {
      const espnTeams = await readJSON(api('sync/teams'), {signal});
      if (signal.aborted) return;
      const matches = espnTeams.filter(t => t.homestreamId === $('team').value && schoolKey(t.name) === schoolKey(school()));
      // A valid timing list without this school is an explicit answer: clock matching is not
      // offered for it. Ambiguous or failed lookups stay retryable with the form visible.
      if (Array.isArray(espnTeams) && !espnTeams.some(t => t.homestreamId === $('team').value)) {
        unsupported = true; $('mapping-note').textContent = 'Clock matching isn’t available for this school. Manual adjustments still work.'; render(); return;
      }
      if (matches.length !== 1 || !Number.isFinite(game.start)) throw Error();
      const schedule = await timingRead(`sync/schedule/${matches[0].id}/${footballSeason(game.start)}`);
      if (signal.aborted) return;
      const event = matchEvent(schedule, school(), game, matches[0].id);
      if (!event) throw Error();
      const key = `${event.id}:${game.url}`;
      if (key !== calibrationKey) { $('offset').value = '0'; calibrationKey = key; }
      const expectedTeams = [...event.teamIds].sort().join('|');
      let pollDelay = 15000;
      async function poll() {
        const started = freshness.start();
        let success = false;
        try {
          const data = await timingRead(`sync/plays/${event.id}`);
          if (signal.aborted) return;
          if (data.schemaVersion !== 2 || data.eventId !== event.id || data.season !== event.season || !Array.isArray(data.teamIds) || [...data.teamIds].sort().join('|') !== expectedTeams || !Array.isArray(data.plays) || typeof data.conflict !== 'boolean') throw Error('timing-invalid');
          clearChoices(); timingReady = true; plays = data.plays; conflict = data.conflict; freshness.receive(transport === 'browser' ? {...data, ageMs:null} : data, started); success = true;
          // Gateway data that arrives stale or with unknown age keeps Retry reachable; browser
          // historical mode is confirmed per play and never needs it for freshness.
          retry.hidden = transport === 'browser' || freshness.fresh();
          $('mapping-note').textContent = transport === 'browser' ? 'Recorded-play mode · freshness unknown. Latest plays or corrections may be missing. Find and confirm a described play, then check the estimated position against the commentary and your TV.' + (conflict ? ' Some reported timestamps are out of order.' : '') : data.ageMs === null ? 'Freshness is unknown, so recent-snapshot seeking is unavailable. Choose ESPN recorded plays for a confirmed historical seek, or adjust audio manually.' : conflict ? 'Estimated only: some sports-data timestamps are out of order. Confirm against the commentary.' : 'Estimated play anchors; a stopped game clock can match more than one play.';
        } catch { if (!signal.aborted) { timingReady = false; clearChoices(); freshness.invalidate(); retry.hidden = false; $('mapping-note').textContent = 'Game timing could not refresh. Recorded-play seeking is paused until a valid update arrives; manual audio controls still work.'; } }
        if (!signal.aborted) { render(); if (success) pollDelay = 15000; pollTimer = setTimeout(poll,pollDelay); pollDelay = nextPollDelay(pollDelay, success); }
      }
      await poll();
    } catch {
      if (!signal.aborted) { retry.hidden = false; $('mapping-note').textContent = transport === 'gateway' ? 'The Homecall timing service is unavailable for this game. Choose ESPN recorded plays above, retry timing, or adjust audio manually.' : 'No unique supported game timing is available. Retry timing without restarting audio, or adjust the audio manually.'; }
    }
  }
  // Label-only status: independent of audio, timing source, calibration, anchors and selection.
  const gameStatus = createGameStatus({ read: (path, options) => readJSON(api(path), options), enabled: () => active && document.visibilityState !== 'hidden', onUpdate: labels => catalog.relabel(labels) });
  // Changing or refreshing the game stops this broadcast, so an active session confirms first.
  const guard = (kind, proceed, revert) => player.active ? ask(kind === 'game' ? { title: 'Change game?', text: 'This broadcast stops. Timing adjustments do not transfer to another game.', action: 'Change game' }
    : { title: 'Refresh games?', text: 'Refreshing the game list stops this broadcast. Press Play again when the feed is ready.', action: 'Refresh' }, proceed, revert) : proceed();
  const catalog = setupHomestream({prefix:'sync-',school,guard,onChange:reset,onReady:() => {
    if (catalog.ready) {
      const selected = `${$('team').value}:${catalog.ready.id}:${catalog.ready.url}`;
      if (selected !== selectionKey) { $('offset').value = '0'; calibrationKey = null; selectionKey = selected; }
      $('title').textContent = `${school()} vs ${catalog.ready.opponent}`; loadMapping(catalog.ready); }
    render();
  }, onGames:(games, {teamId}) => { statusCatalog = {games, teamId}; gameStatus.setGames({games, teamId, school:school()}); }, onCatalogInvalidated:() => { statusCatalog = null; gameStatus.clear(); }});
  function render() {
    const timing = player.timing(), fresh = freshness.fresh();
    const ageLabel = freshness.status() === 'unknown' ? 'freshness unknown' : 'stale data';
    const anchors = availableAnchors(plays,timing,offset()).sort(gameOrder);
    $('play').disabled = !catalog.ready;
    $('play').textContent = player.active ? 'Reconnect' : 'Play';
    $('stop').disabled = !player.active;
    // The clock form stays visible but disabled until a chosen source has usable timing; only an
    // explicit unsupported answer hides it. Manual adjustments never depend on it.
    $('clock-form').hidden = unsupported;
    $('clock-fields').disabled = !canSeek();
    // Valid gateway timing that has aged past freshness disables seeking; offer Retry instead.
    if (source.value === 'gateway' && timingReady && !fresh) retry.hidden = false;
    $('apply').disabled = !canSeek() || !anchors.length;
    $('incoming').disabled = !player.active || !timing.ranges.length;
    document.querySelectorAll('[data-sync-nudge]').forEach(b => { b.disabled = !player.active || !timing.ranges.length; });
    const format = value => new Date(value).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'});
    $('now').textContent = format(Date.now());
    $('audio-time').textContent = Number.isFinite(timing.utc) ? format(timing.utc) : player.active ? 'Timestamp unavailable in this browser or feed' : 'Start audio to see its timestamp';
    const previous = anchors.filter(p => p.position <= timing.position).sort((a,b) => a.position-b.position).at(-1);
    $('mapped').textContent = previous ? `${playLabel(previous)} · estimated anchor${fresh?'':` · ${ageLabel}`}` : 'No matching play anchor';
    $('range').textContent = anchors.length ? `${playLabel(anchors[0])} → ${playLabel(anchors.at(-1))} (earliest → latest)${fresh?'':` · ${ageLabel}`}` : 'No recorded plays inside the available audio window';
    $('range-note').textContent = 'Recorded-play bounds, not a running game clock. A stopped clock can match several plays. Find a play, confirm its description, then fine-tune by ear. Overtime uses manual adjustment.';
    scoreboard?.check();
  }
  async function loadTeams() {
    teamsController?.abort(); const signal = (teamsController = new AbortController()).signal;
    $('team').disabled = true; $('teams-retry').disabled = true; $('team-note').textContent = 'Loading available schools…';
    try {
      const teams = await readJSON(api('homestream/teams'),{signal});
      if (signal.aborted) return;
      const previous = school(); $('team').replaceChildren();
      for (const team of teams) { const o = document.createElement('option'); o.value = team.id; o.textContent = team.name; $('team').append(o); }
      const preferred = teams.find(t => schoolKey(t.name) === schoolKey(previous));
      if (preferred) $('team').value = preferred.id;
      committedTeam = $('team').value;
      $('team-note').textContent = teams.length ? 'Choose a school and game. Feeds are checked before playback.' : 'No schools are currently listed.';
      if (teams.length) catalog.setEnabled(true);
    } catch { if (!signal.aborted) $('team-note').textContent = 'Schools could not load. Retry when the catalog service is available.'; }
    finally { if (!signal.aborted) { $('team').disabled = !$('team').options.length; $('teams-retry').disabled = false; } }
  }
  // School changes and reloads stop an active broadcast; the select keeps the committed school while asking.
  $('team').onchange = () => {
    const next = $('team').value;
    ask(player.active ? { title: 'Change school?', text: 'This broadcast stops. Timing adjustments do not transfer.', action: 'Change school' } : null,
      () => { $('team').value = committedTeam = next; $('offset').value = '0'; catalog.setEnabled(true); }, () => { $('team').value = committedTeam; });
  };
  $('teams-retry').onclick = () => ask(player.active ? { title: 'Reload schools?', text: 'Reloading the school list stops this broadcast.', action: 'Reload' } : null,
    () => { catalog.setEnabled(false); reset(); loadTeams(); });
  // Continue runs start() inside its own click, so playback keeps the user gesture.
  function start() {
    if (!catalog.ready || player.active) return;
    flag(false);
    stopLive(); clearChoices(); claim(catalog.ready); player.start(catalog.ready.url); render();
  }
  $('play').onclick = () => {
    if (!catalog.ready) return;
    if (player.active) { ask({ title: 'Reconnect this broadcast?', text: 'The game list refreshes and audio stops. Press Play again when the feed is ready.', action: 'Reconnect' }, () => catalog.refresh()); return; }
    ask(liveActive() ? { title: 'Play this game broadcast?', text: 'Radio stops so the game broadcast can play.', action: 'Play broadcast' } : null, start);
  };
  $('stop').onclick = () => { confirm?.cancel(); clearChoices(); release(); player.stop(); $('playback').textContent = 'Stopped.'; flag(false); render(); };
  $('incoming').onclick = () => { $('result').textContent = player.live() ? 'Moved to incoming audio. Check against your TV.' : 'No live audio window is available yet.'; };
  document.querySelectorAll('[data-sync-nudge]').forEach(b => { b.onclick = () => {
    const delta = Number(b.dataset.syncNudge);
    $('result').textContent = player.seek(audio.currentTime+delta) ? 'Audio adjusted. Check alignment.' : 'Reached the available audio limit.';
  }; });
  function applyAnchor(anchor, version) {
    // Recalculate against the current audio position/window, never a captured button position.
    const current = availableAnchors(plays,player.timing(),offset()).find(p => p.id === anchor.id);
    if (version !== snapshot || !canSeek() || !current || !player.seek(current.position)) {
      $('result').textContent = 'That play is no longer available. Check the range and try again.'; return;
    }
    $('result').textContent = `Moved to recorded play ${playLabel(current)} · ${current.text}. Estimated position; listen and compare with your TV, then fine-tune. This does not confirm alignment.`;
  }
  $('clock-form').onsubmit = event => {
    event.preventDefault(); $('matches').replaceChildren(); invitation = null;
    if (!canSeek()) { $('result').textContent = 'Start audio and wait for valid game timing. The Homecall service also requires a recent snapshot. Manual controls remain available.'; return; }
    const result = selectAnchors(availableAnchors(plays,player.timing(),offset()),Number($('quarter').value),$('clock').value);
    if (result.status !== 'ready') { $('result').textContent = result.status === 'invalid' ? 'Enter a clock from 0:00 to 15:00, such as 7:29.' : 'That clock is outside the available game-time anchors. Playback has not moved.'; return; }
    const version = snapshot;
    {
      $('result').textContent = result.distance ? `Nearest recorded play is ${result.distance} game-clock seconds away. Confirm a play below before moving audio:` : result.matches.length > 1 ? 'Several plays match that clock. Choose the play you see on TV:' : `Confirm this recorded play before moving audio. Its timestamp is approximate${source.value === 'browser' ? ' and freshness is unknown' : ''}:`;
      invitation = $('result').textContent;
      for (const p of result.matches) { const b = document.createElement('button'); b.type = 'button'; b.textContent = `${playLabel(p)} · ${p.text}`; b.onclick = () => applyAnchor(p, version); $('matches').append(b); }
    }
    render();
  };
  $('offset').oninput = () => { clearChoices(); render(); };
  document.addEventListener('visibilitychange', () => {
    freshness.invalidate();
    if (document.visibilityState === 'hidden') gameStatus.suspend(); else gameStatus.resume();
    if (!active) return;
    clearMapping();
    if (document.visibilityState === 'visible' && catalog.ready) void loadMapping(catalog.ready);
    render();
  });
  setInterval(() => { if (active) { render(); gameStatus.tick(); } },1000);
  return {
    get active() { return player.active; },
    activate() { active = true; reset(); loadTeams(); },
    deactivate() { active = false; teamsController?.abort(); catalog.setEnabled(false); gameStatus.stop(); reset(); },
  };
}
