import { browserTiming } from './timing-transport.js';
import { createTimingFreshness, nextPollDelay } from './timing-freshness.js';
import { metadataURL } from './gateway.js';
import { readJSON } from './homestream.js';
import { schoolKey, footballSeason, matchEvent, selectAnchors, gameOrder, playLabel, clockSeconds } from './sync-mapping.js';
const CHOOSE_SOURCE = 'Choose a timing source to find a play by TV clock. Manual adjustments work without it.';
// Recorded plays that map into exactly one timestamped span of the current seekable window. A target
// is evaluated on its own: it never needs, or invents, a timestamp for the audio currently heard.
export function targetAnchors(plays, { ranges = [], spans = [] } = {}, offset = 0) {
  if (!Number.isFinite(offset)) return [];
  return plays.flatMap(p => {
    const utc = p.utc + offset * 1000;
    const matching = spans.filter(span => utc >= span.utc && utc < span.utc + span.duration * 1000);
    // Overlapping timestamps across discontinuities are ambiguous, never guessed.
    if (matching.length !== 1) return [];
    return [{ ...p, position: matching[0].position + (utc - matching[0].utc) / 1000 }];
  }).filter(p => Number.isFinite(clockSeconds(p.clock)) && ranges.some(([start, end]) => p.position >= start && p.position <= end));
}
// Match my TV game-timing tools for a playing catalog game feed in Listen. They never own audio:
// seek(position) asks the Listen owner to move playback and resolves to the player's result.
// player supplies timing(), timestampState() and canMove(); schoolName/teamId describe the selected team.
export function setupGameTiming({ player, seek, schoolName = () => '', teamId = () => null, onChange = () => {} }) {
  const $ = id => document.getElementById(`sync-${id}`);
  const api = path => metadataURL(path, document.baseURI, typeof __GATEWAY_ORIGIN__ === 'string' ? __GATEWAY_ORIGIN__ : '', { allowLocal: typeof __GATEWAY_ALLOW_LOCAL__ === 'boolean' && __GATEWAY_ALLOW_LOCAL__ });
  const freshness = createTimingFreshness();
  // Timing source starts unset; choosing one never moves or restarts audio.
  const retry = $('timing-retry'), source = $('timing-source');
  let game = null, mappingController, pollTimer, plays = [], conflict = false, calibrationKey = null, selectionKey = null, snapshot = 0, timingReady = false, unsupported = false;
  const offset = () => { const n = Number($('offset').value); return Number.isFinite(n) ? n : 0; };
  const canSeek = () => !!game && player.canMove() && timingReady && (source.value === 'browser' || freshness.fresh());
  const anchors = () => targetAnchors(plays, player.timing(), offset()).sort(gameOrder);
  // Invalidated choices also take their own "choose a play" invitation with them; any newer
  // feedback (seek result or error) has replaced that text and stays.
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
  source.onchange = () => { calibrationKey = null; $('offset').value = '0'; clearMapping(); if (game) void loadMapping(); render(); };
  retry.onclick = () => { if (game) void loadMapping(); };
  async function loadMapping() {
    clearMapping();
    if (!game || document.visibilityState === 'hidden' || !source.value) return;
    const controller = mappingController = new AbortController(), signal = controller.signal, current = game;
    const transport = source.value;
    const timingRead = path => transport === 'browser' ? browserTiming(path, {signal}) : readJSON(api(path), {signal});
    $('mapping-note').textContent = 'Finding matching game timing…';
    try {
      const espnTeams = await readJSON(api('sync/teams'), {signal});
      if (signal.aborted) return;
      const id = teamId(), school = schoolName();
      const matches = espnTeams.filter(t => t.homestreamId === id && schoolKey(t.name) === schoolKey(school));
      // A valid timing list without this school is an explicit answer: clock matching is not
      // offered for it. Ambiguous or failed lookups stay retryable with the form visible.
      if (Array.isArray(espnTeams) && !espnTeams.some(t => t.homestreamId === id)) {
        unsupported = true; $('mapping-note').textContent = 'Clock matching isn’t available for this school. Manual adjustments still work.'; render(); return;
      }
      if (matches.length !== 1 || !Number.isFinite(current.start)) throw Error();
      const schedule = await timingRead(`sync/schedule/${matches[0].id}/${footballSeason(current.start)}`);
      if (signal.aborted) return;
      const event = matchEvent(schedule, school, current, matches[0].id);
      if (!event) throw Error();
      const key = `${event.id}:${current.url}`;
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
  function render() {
    const timing = player.timing(), fresh = freshness.fresh(), list = anchors();
    const ageLabel = freshness.status() === 'unknown' ? 'freshness unknown' : 'stale data';
    // The clock form stays visible but disabled until a chosen source has usable timing; only an
    // explicit unsupported answer hides it. Manual adjustments never depend on it.
    $('clock-form').hidden = unsupported;
    $('clock-fields').disabled = !canSeek();
    // Valid gateway timing that has aged past freshness disables seeking; offer Retry instead.
    if (source.value === 'gateway' && timingReady && !fresh) retry.hidden = false;
    $('apply').disabled = !canSeek() || !list.length;
    const format = value => new Date(value).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'});
    $('now').textContent = format(Date.now());
    // Estimated: the PCM read head mapped through verified contiguous input, without measured output latency.
    $('audio-time').textContent = Number.isFinite(timing.utc) ? `${format(timing.utc)} · estimated` : game ? 'Unavailable for the audio you hear now' : 'Start a game feed to see its timestamp';
    const previous = Number.isFinite(timing.position) ? list.filter(p => p.position <= timing.position).sort((a,b) => a.position-b.position).at(-1) : null;
    $('mapped').textContent = previous ? `${playLabel(previous)} · estimated anchor${fresh?'':` · ${ageLabel}`}` : 'No matching play anchor';
    $('range').textContent = list.length ? `${playLabel(list[0])} → ${playLabel(list.at(-1))} (earliest → latest)${fresh?'':` · ${ageLabel}`}` : 'No recorded plays inside the available audio window';
    $('range-note').textContent = 'Recorded-play bounds, not a running game clock. A stopped clock can match several plays. Find a play, confirm its description, then fine-tune by ear. Overtime uses manual adjustment.';
    onChange();
  }
  async function applyAnchor(anchor, version) {
    // Recalculate against the current audio window, never a captured button position.
    const current = anchors().find(p => p.id === anchor.id);
    if (version !== snapshot || !canSeek() || !current) { $('result').textContent = 'That play is no longer available. Check the range and try again.'; render(); return; }
    clearChoices();
    $('result').textContent = `Moving to recorded play ${playLabel(current)}…`;
    const moved = await seek(current.position);
    if (moved === 'applied' || moved === 'history') $('result').textContent = `Moved to recorded play ${playLabel(current)} · ${current.text}. Estimated position; listen and compare with your TV, then fine-tune. This does not confirm alignment.`;
    else if (moved === 'unavailable') $('result').textContent = 'That play is no longer available. Check the range and try again.';
    else if (moved !== 'stale') $('result').textContent = 'The move to that play could not be confirmed. Check the audio against your TV and adjust manually.';
    render();
  }
  $('clock-form').onsubmit = event => {
    event.preventDefault(); $('matches').replaceChildren(); invitation = null;
    if (!canSeek()) { $('result').textContent = 'Start audio and wait for valid game timing. The Homecall service also requires a recent snapshot. Manual controls remain available.'; return; }
    const result = selectAnchors(anchors(), Number($('quarter').value), $('clock').value);
    if (result.status !== 'ready') { $('result').textContent = result.status === 'invalid' ? 'Enter a clock from 0:00 to 15:00, such as 7:29.' : 'That clock is outside the available game-time anchors. Playback has not moved.'; return; }
    const version = snapshot;
    $('result').textContent = result.distance ? `Nearest recorded play is ${result.distance} game-clock seconds away. Confirm a play below before moving audio:` : result.matches.length > 1 ? 'Several plays match that clock. Choose the play you see on TV:' : `Confirm this recorded play before moving audio. Its timestamp is approximate${source.value === 'browser' ? ' and freshness is unknown' : ''}:`;
    invitation = $('result').textContent;
    for (const p of result.matches) { const b = document.createElement('button'); b.type = 'button'; b.textContent = `${playLabel(p)} · ${p.text}`; b.onclick = () => applyAnchor(p, version); $('matches').append(b); }
    render();
  };
  $('offset').oninput = () => { clearChoices(); render(); };
  document.addEventListener('visibilitychange', () => {
    freshness.invalidate();
    if (!game) return;
    clearMapping();
    if (document.visibilityState === 'visible') void loadMapping();
    render();
  });
  setInterval(() => { if (game) render(); }, 1000);
  return {
    get active() { return !!game; },
    // A playing game feed starts timing lookups; a new team, game or feed address starts uncalibrated.
    start(next) {
      const key = `${teamId()}:${next.id}:${next.url}`;
      if (key !== selectionKey) { $('offset').value = '0'; calibrationKey = null; selectionKey = key; }
      game = next; $('result').textContent = ''; void loadMapping(); render();
    },
    stop() { game = null; clearMapping(); $('result').textContent = ''; render(); },
    // Cross-source or recovery boundary: old play choices expire; reset also drops calibration.
    invalidate() { clearChoices(); render(); },
    reset() { $('offset').value = '0'; calibrationKey = null; selectionKey = null; clearChoices(); },
    render,
  };
}
