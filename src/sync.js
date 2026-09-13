import { createTimingFreshness, nextPollDelay } from './timing-freshness.js';
import { metadataURL } from './gateway.js';
import { readJSON } from './homestream.js';
import { setupHomestream } from './homestream-ui.js';
import { SyncPlayer } from './sync-player.js';
import { schoolKey, matchEvent, availableAnchors, selectAnchors, gameOrder, playLabel } from './sync-mapping.js';
export function setupSync({ initialSchool = () => 'Duke' } = {}) {
  const $ = id => document.getElementById(`sync-${id}`);
  const audio = $('audio'), player = new SyncPlayer(audio, text => { $('playback').textContent = text; });
  let active = false, teamsController, mappingController, pollTimer, plays = [], conflict = false, calibrationKey = null;
  const api = path => metadataURL(path, document.baseURI, typeof __GATEWAY_ORIGIN__ === 'string' ? __GATEWAY_ORIGIN__ : '', { allowLocal: typeof __GATEWAY_ALLOW_LOCAL__ === 'boolean' && __GATEWAY_ALLOW_LOCAL__ });
  const freshness = createTimingFreshness();
  const school = () => $('team').selectedOptions[0]?.textContent || initialSchool();
  const offset = () => { const n = Number($('offset').value); return Number.isFinite(n) ? n : 0; };
  function clearMapping() {
    mappingController?.abort(); mappingController = null; clearTimeout(pollTimer);
    plays = []; freshness.invalidate(); conflict = false; $('matches').replaceChildren();
    $('mapping-note').textContent = 'Waiting for game timing data.';
  }
  function reset() {
    player.stop(); clearMapping(); $('playback').textContent = 'Stopped.';
    $('result').textContent = ''; render();
  }
  async function loadMapping(game) {
    clearMapping();
    if (document.visibilityState === 'hidden') return;
    const controller = mappingController = new AbortController(), signal = controller.signal;
    $('mapping-note').textContent = 'Finding matching game timing…';
    try {
      const espnTeams = await readJSON(api('sync/teams'), {signal});
      if (signal.aborted) return;
      const matches = espnTeams.filter(t => schoolKey(t.name) === schoolKey(school()));
      if (matches.length !== 1 || !Number.isFinite(game.start)) throw Error();
      const schedule = await readJSON(api(`sync/schedule/${matches[0].id}/${new Date(game.start).getUTCFullYear()}`), {signal});
      if (signal.aborted) return;
      const event = matchEvent(schedule, school(), game);
      if (!event) throw Error();
      let pollDelay = 15000;
      async function poll() {
        const started = freshness.start();
        let success = false;
        try {
          const data = await readJSON(api(`sync/plays/${event.id}`), {signal});
          if (signal.aborted) return;
          if (!Array.isArray(data.plays) || typeof data.conflict !== 'boolean') throw Error('timing-invalid');
          plays = data.plays; conflict = data.conflict; freshness.receive(data, started); success = true;
          $('mapping-note').textContent = conflict ? 'Estimated only: some sports-data timestamps are out of order. Confirm against the commentary.' : 'Estimated play anchors; a stopped game clock can match more than one play.';
        } catch { if (!signal.aborted) $('mapping-note').textContent = 'Game timing is unavailable or the service limit was reached. Retrying less often; older anchors expire and manual audio controls still work.'; }
        if (!signal.aborted) { render(); if (success) pollDelay = 15000; pollTimer = setTimeout(poll,pollDelay); pollDelay = nextPollDelay(pollDelay, success); }
      }
      await poll();
    } catch {
      if (!signal.aborted) $('mapping-note').textContent = 'No unique matching game timing is available. You can still listen and adjust the audio manually.';
    }
  }
  const catalog = setupHomestream({prefix:'sync-',school,onChange:reset,onReady:() => {
    if (catalog.ready) {
      const key = `${school()}:${catalog.ready.id}`;
      if (key !== calibrationKey) { $('offset').value = '0'; calibrationKey = key; }
      $('title').textContent = `${school()} vs ${catalog.ready.opponent}`; loadMapping(catalog.ready); }
    render();
  }});
  function render() {
    const timing = player.timing(), fresh = freshness.fresh();
    const anchors = availableAnchors(plays,timing,offset()).sort(gameOrder);
    $('play').disabled = !catalog.ready;
    $('stop').disabled = !player.active;
    $('apply').disabled = !player.active || !fresh || !anchors.length;
    $('incoming').disabled = !player.active || !timing.ranges.length;
    document.querySelectorAll('[data-sync-nudge]').forEach(b => { b.disabled = !player.active || !timing.ranges.length; });
    const format = value => new Date(value).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'});
    $('now').textContent = format(Date.now());
    $('audio-time').textContent = Number.isFinite(timing.utc) ? format(timing.utc) : player.active ? 'Timestamp unavailable in this browser or feed' : 'Start audio to see its timestamp';
    const previous = anchors.filter(p => p.position <= timing.position).sort((a,b) => a.position-b.position).at(-1);
    $('mapped').textContent = previous ? `${playLabel(previous)} · estimated anchor${fresh?'':' · stale data'}` : 'No matching play anchor';
    $('range').textContent = anchors.length ? `${playLabel(anchors[0])} → ${playLabel(anchors.at(-1))} (earliest → latest)${fresh?'':' · stale data'}` : 'No recorded plays inside the available audio window';
    $('range-note').textContent = 'Estimated bounds. Times between recorded plays may be ambiguous; the game clock does not run continuously.';
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
    player.start(catalog.ready.url); render();
  };
  $('stop').onclick = () => { player.stop(); $('playback').textContent = 'Stopped.'; render(); };
  $('incoming').onclick = () => { $('result').textContent = player.live() ? 'Moved to incoming audio. Check against your TV.' : 'No live audio window is available yet.'; };
  document.querySelectorAll('[data-sync-nudge]').forEach(b => { b.onclick = () => {
    const delta = Number(b.dataset.syncNudge);
    $('result').textContent = player.seek(audio.currentTime+delta) ? 'Audio adjusted. Check alignment.' : 'Reached the available audio limit.';
  }; });
  function applyAnchor(anchor) {
    // Recalculate against the current audio position/window, never a captured button position.
    const current = availableAnchors(plays,player.timing(),offset()).find(p => p.id === anchor.id);
    if (!freshness.fresh() || !current || !player.seek(current.position)) {
      $('result').textContent = 'That play is no longer available. Check the range and try again.'; return;
    }
    $('result').textContent = `Moved to ${playLabel(current)} — estimated alignment. Press Play if paused, then compare with your TV.`;
  }
  $('clock-form').onsubmit = event => {
    event.preventDefault(); $('matches').replaceChildren();
    if (!freshness.fresh()) { $('result').textContent = 'Wait for fresh game timing data.'; return; }
    const result = selectAnchors(availableAnchors(plays,player.timing(),offset()),Number($('quarter').value),$('clock').value);
    if (result.status !== 'ready') { $('result').textContent = result.status === 'invalid' ? 'Enter a clock from 0:00 to 15:00, such as 7:29.' : 'That clock is outside the available game-time anchors. Playback has not moved.'; return; }
    if (result.matches.length === 1) { applyAnchor(result.matches[0]); if (result.distance) $('result').textContent += ` Nearest recorded play is ${result.distance} game-clock seconds away.`; }
    else {
      $('result').textContent = 'Several plays match that clock. Choose the play you see on TV:';
      for (const p of result.matches) { const b = document.createElement('button'); b.type = 'button'; b.textContent = `${playLabel(p)} · ${p.text}`; b.onclick = () => applyAnchor(p); $('matches').append(b); }
    }
    render();
  };
  $('offset').oninput = () => { $('matches').replaceChildren(); render(); };
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
