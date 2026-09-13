import { browserTiming } from './timing-transport.js';
import { createTimingFreshness, nextPollDelay } from './timing-freshness.js';
import { metadataURL } from './gateway.js';
import { readJSON } from './homestream.js';
import { setupHomestream } from './homestream-ui.js';
import { SyncPlayer } from './sync-player.js';
import { schoolKey, footballSeason, matchEvent, availableAnchors, selectAnchors, gameOrder, playLabel } from './sync-mapping.js';
export function setupSync({ initialSchool = () => 'Duke' } = {}) {
  const $ = id => document.getElementById(`sync-${id}`);
  const audio = $('audio'), player = new SyncPlayer(audio, text => { $('playback').textContent = text; });
  let active = false, teamsController, mappingController, pollTimer, plays = [], conflict = false, calibrationKey = null, selectionKey = null, snapshot = 0, timingReady = false;
  const api = path => metadataURL(path, document.baseURI, typeof __GATEWAY_ORIGIN__ === 'string' ? __GATEWAY_ORIGIN__ : '', { allowLocal: typeof __GATEWAY_ALLOW_LOCAL__ === 'boolean' && __GATEWAY_ALLOW_LOCAL__ });
  const freshness = createTimingFreshness();
  const retry = document.createElement('button');
  retry.id = 'sync-timing-retry'; retry.type = 'button'; retry.textContent = 'Retry game timing'; retry.hidden = true;
  $('mapping-note').after(retry);
  const sourceLabel = document.createElement('label'), source = document.createElement('select');
  sourceLabel.htmlFor = 'sync-timing-source'; sourceLabel.textContent = 'Game timing source'; source.id = 'sync-timing-source';
  for (const [value, label] of [['', 'Choose a timing source'], ['browser', 'ESPN recorded plays · confirm before seeking'], ['gateway', 'Homecall service · estimated plays']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; source.append(option); }
  retry.after(sourceLabel, source);
  source.onchange = () => { calibrationKey = null; $('offset').value = '0'; clearMapping(); if (active && catalog.ready) void loadMapping(catalog.ready); render(); };
  retry.onclick = () => { if (active && catalog.ready) void loadMapping(catalog.ready); };
  const school = () => $('team').selectedOptions[0]?.textContent || initialSchool();
  const offset = () => { const n = Number($('offset').value); return Number.isFinite(n) ? n : 0; };
  const canSeek = () => player.active && timingReady && (source.value === 'browser' || freshness.fresh());
  function clearChoices() { snapshot++; $('matches').replaceChildren(); }
  function clearMapping() {
    mappingController?.abort(); mappingController = null; clearTimeout(pollTimer);
    plays = []; timingReady = false; freshness.invalidate(); conflict = false; clearChoices(); retry.hidden = true;
    $('mapping-note').textContent = 'Waiting for game timing data.';
  }
  function reset() {
    player.stop(); clearMapping(); $('playback').textContent = 'Stopped.';
    $('result').textContent = ''; render();
  }
  async function loadMapping(game) {
    clearMapping();
    if (!active || document.visibilityState === 'hidden') return;
    if (!source.value) { $('mapping-note').textContent = 'Choose ESPN recorded plays below to find a described play. Timing is an estimate; confirm it against the commentary and your TV. Manual controls work without game timing.'; return; }
    const controller = mappingController = new AbortController(), signal = controller.signal;
    const transport = source.value;
    const timingRead = path => transport === 'browser' ? browserTiming(path, {signal}) : readJSON(api(path), {signal});
    $('mapping-note').textContent = 'Finding matching game timing…';
    try {
      const espnTeams = await readJSON(api('sync/teams'), {signal});
      if (signal.aborted) return;
      const matches = espnTeams.filter(t => t.homestreamId === $('team').value && schoolKey(t.name) === schoolKey(school()));
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
          retry.hidden = true;
          $('mapping-note').textContent = transport === 'browser' ? 'Recorded-play mode · freshness unknown. Latest plays or corrections may be missing. Find and confirm a described play, then check the estimated position against the commentary and your TV.' + (conflict ? ' Some reported timestamps are out of order.' : '') : data.ageMs === null ? 'Freshness is unknown, so recent-snapshot seeking is unavailable. Choose ESPN recorded plays for a confirmed historical seek, or adjust audio manually.' : conflict ? 'Estimated only: some sports-data timestamps are out of order. Confirm against the commentary.' : 'Estimated play anchors; a stopped game clock can match more than one play.';
        } catch { if (!signal.aborted) { timingReady = false; clearChoices(); freshness.invalidate(); retry.hidden = false; $('mapping-note').textContent = 'Game timing could not refresh. Recorded-play seeking is paused until a valid update arrives; manual audio controls still work.'; } }
        if (!signal.aborted) { render(); if (success) pollDelay = 15000; pollTimer = setTimeout(poll,pollDelay); pollDelay = nextPollDelay(pollDelay, success); }
      }
      await poll();
    } catch {
      if (!signal.aborted) { retry.hidden = false; $('mapping-note').textContent = transport === 'gateway' ? 'The Homecall timing service is unavailable for this game. Choose ESPN recorded plays below, retry timing, or adjust audio manually.' : 'No unique supported game timing is available. Retry timing without restarting audio, or adjust the audio manually.'; }
    }
  }
  const catalog = setupHomestream({prefix:'sync-',school,onChange:reset,onReady:() => {
    if (catalog.ready) {
      const selected = `${$('team').value}:${catalog.ready.id}:${catalog.ready.url}`;
      if (selected !== selectionKey) { $('offset').value = '0'; calibrationKey = null; selectionKey = selected; }
      $('title').textContent = `${school()} vs ${catalog.ready.opponent}`; loadMapping(catalog.ready); }
    render();
  }});
  function render() {
    const timing = player.timing(), fresh = freshness.fresh();
    const ageLabel = freshness.status() === 'unknown' ? 'freshness unknown' : 'stale data';
    const anchors = availableAnchors(plays,timing,offset()).sort(gameOrder);
    $('play').disabled = !catalog.ready;
    $('stop').disabled = !player.active;
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
      $('team-note').textContent = teams.length ? 'Choose a school and game. Feeds are checked before playback.' : 'No schools are currently listed.';
      if (teams.length) catalog.setEnabled(true);
    } catch { if (!signal.aborted) $('team-note').textContent = 'Schools could not load. Retry when the catalog service is available.'; }
    finally { if (!signal.aborted) { $('team').disabled = !$('team').options.length; $('teams-retry').disabled = false; } }
  }
  $('team').onchange = () => { $('offset').value = '0'; catalog.setEnabled(true); };
  $('teams-retry').onclick = () => { catalog.setEnabled(false); reset(); loadTeams(); };
  $('play').onclick = () => {
    if (!catalog.ready) return;
    if (player.active) { catalog.refresh(); return; }
    clearChoices(); player.start(catalog.ready.url); render();
  };
  $('stop').onclick = () => { clearChoices(); player.stop(); $('playback').textContent = 'Stopped.'; render(); };
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
    event.preventDefault(); $('matches').replaceChildren();
    if (!canSeek()) { $('result').textContent = 'Start audio and wait for valid game timing. The Homecall service also requires a recent snapshot. Manual controls remain available.'; return; }
    const result = selectAnchors(availableAnchors(plays,player.timing(),offset()),Number($('quarter').value),$('clock').value);
    if (result.status !== 'ready') { $('result').textContent = result.status === 'invalid' ? 'Enter a clock from 0:00 to 15:00, such as 7:29.' : 'That clock is outside the available game-time anchors. Playback has not moved.'; return; }
    const version = snapshot;
    {
      $('result').textContent = result.distance ? `Nearest recorded play is ${result.distance} game-clock seconds away. Confirm a play below before moving audio:` : result.matches.length > 1 ? 'Several plays match that clock. Choose the play you see on TV:' : `Confirm this recorded play before moving audio. Its timestamp is approximate${source.value === 'browser' ? ' and freshness is unknown' : ''}:`;
      for (const p of result.matches) { const b = document.createElement('button'); b.type = 'button'; b.textContent = `${playLabel(p)} · ${p.text}`; b.onclick = () => applyAnchor(p, version); $('matches').append(b); }
    }
    render();
  };
  $('offset').oninput = () => { clearChoices(); render(); };
  document.addEventListener('visibilitychange', () => {
    freshness.invalidate();
    if (!active) return;
    clearMapping();
    if (document.visibilityState === 'visible' && catalog.ready) void loadMapping(catalog.ready);
    render();
  });
  setInterval(() => { if (active) render(); },1000);
  return {
    activate() { active = true; reset(); loadTeams(); },
    deactivate() { active = false; teamsController?.abort(); catalog.setEnabled(false); reset(); },
  };
}
