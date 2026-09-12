import { teams } from './teams.js';
import { filterReplays, seekReplay, stopReplay, validateCatalog } from './replay.js';
export function setupArchive({ stopLive, selectedTeam, memory, sync = null }) {
  const $ = id => document.getElementById(id);
  const audio = $('replay-audio');
  let replayKey = null, restorePosition = null, restoreAttempts = 0, playingStarted = false, failedRestoreAt = null, lastSaved = null;
  function savePosition() {
    // A failed restore must not disable bookmarking for the rest of the listening session.
    // Wait for actual playback progress so a transient reset to zero cannot erase the old bookmark.
    if (restorePosition !== null && failedRestoreAt !== null && playingStarted && !audio.paused && audio.currentTime >= failedRestoreAt + 2) {
      restorePosition = null; failedRestoreAt = null;
    }
    if (replayKey && restorePosition === null && Number.isFinite(audio.currentTime) && audio.readyState >= 1 && audio.currentTime !== lastSaved) {
      lastSaved = audio.currentTime; memory?.save('replay', replayKey, lastSaved);
    }
  }
  let catalog = null, current = null, mode = 'live', loadGeneration = 0, catalogError = false, playRequest = 0;
  const message = text => { $('replay-status').textContent = text; };
  function stop() {
    savePosition(); replayKey = null; restorePosition = null; ++playRequest; stopReplay(audio); current = null; $('replay-player').hidden = true;
  }
  const modes = sync ? ['live', 'sync', 'archive'] : ['live', 'archive'];
  function selectMode(next) {
    if (next === mode) return;
    mode = next;
    stopLive(); stop(); sync?.deactivate();
    for (const name of modes) {
      $(`${name}-tab`).setAttribute('aria-selected', String(name === mode));
      $(`${name}-tab`).tabIndex = name === mode ? 0 : -1;
    }
    $('live-panel').hidden = mode !== 'live';
    $('archive-panel').hidden = mode !== 'archive';
    $('live-sidebar').hidden = mode !== 'live';
    if (sync) { $('sync-panel').hidden = mode !== 'sync'; if (mode === 'sync') sync.activate(); }
    if (mode === 'archive') { $('archive-team').value = [...$('archive-team').options].some(o => o.value === selectedTeam()) ? selectedTeam() : 'duke'; render(true); }
  }
  for (const name of modes) {
    $(`${name}-tab`).onclick = () => selectMode(name);
    $(`${name}-tab`).onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? modes[0] : event.key === 'End' ? modes.at(-1) : modes[(modes.indexOf(mode) + (event.key === 'ArrowRight' ? 1 : modes.length-1)) % modes.length];
      selectMode(next); $(`${next}-tab`).focus();
    };
  }
  function options(id, values, label) {
    const previous = $(id).value;
    $(id).replaceChildren(new Option(label, ''), ...values.map(value => new Option(value, value)));
    if (values.includes(previous)) $(id).value = previous;
  }
  function render(reset = false) {
    const key = $('archive-team').value, team = teams[key], source = catalog?.schools[key];
    $('archive-official').href = source?.source || team.official;
    if (reset) { stop(); $('archive-sport').value = ''; $('archive-year').value = ''; }
    {
      const items = source?.items || [];
      options('archive-sport', [...new Set(items.map(x => x.sport))].sort(), 'All sports');
      options('archive-year', [...new Set(items.map(x => x.start.slice(0, 4)))].sort().reverse(), 'All years');
    }
    const items = filterReplays(source?.items || [], $('archive-sport').value, $('archive-year').value);
    $('archive-list').replaceChildren();
    $('archive-note').textContent = !catalog ? (catalogError ? 'The archive catalog could not load. Try again or visit the official site.' : 'Loading recordings…') : source?.status === 'unavailable' ? `We couldn’t refresh ${team.name}’s archive. Try the official site below.` : source?.status === 'external' ? `In-app recordings aren’t available for ${team.name} yet. Visit the official site for listening options.` : `${items.length} recordings · Catalog checked ${new Date(catalog.checkedAt).toLocaleString()}. Scores are omitted; broadcaster titles may contain spoilers. Recordings may include pregame and postgame audio.`;
    if (source?.status === 'ready' && !items.length) $('archive-note').textContent = 'No recordings match these filters. Try another sport or year.';
    for (const item of items) {
      const li = document.createElement('li'), button = document.createElement('button');
      const title = document.createElement('strong'), detail = document.createElement('span');
      title.textContent = `${team.name} · ${item.opponent}`;
      detail.textContent = `${item.sport} · ${new Date(item.start).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York' })} · ${item.kind}`;
      button.append(title, detail); button.setAttribute('aria-label', `Play ${title.textContent}, ${detail.textContent}`);
      button.onclick = () => {
        stop(); current = item; replayKey = `${key}:${item.id}`; lastSaved = null; restoreAttempts = 0; playingStarted = false; failedRestoreAt = null; restorePosition = memory?.read('replay', replayKey)?.value ?? null; $('replay-player').hidden = false;
        $('replay-title').textContent = title.textContent; $('replay-audio').src = item.url;
        audio.playbackRate = Number($('replay-speed').value);
        message('Loading recording…');
        const request = ++playRequest;
        audio.play().catch(() => { if (request === playRequest) message('Press Play in the audio controls. If playback fails, try the official site.'); });
      };
      li.append(button); $('archive-list').append(li);
    }
  }
  $('archive-team').onchange = () => render(true);
  $('archive-sport').onchange = $('archive-year').onchange = () => render();
  $('replay-speed').onchange = () => { audio.playbackRate = Number($('replay-speed').value); };
  document.querySelectorAll('[data-replay-seek]').forEach(button => {
    button.onclick = () => {
      if (!seekReplay(audio, Number(button.dataset.replaySeek))) message('Wait for the recording to load before adjusting its position.');
      else { restorePosition = null; savePosition(); message('Position adjusted. Check against the TV replay.'); }
    };
  });
  $('replay-hold').onclick = () => { ++playRequest; audio.pause(); message('Audio paused at the play. When you see it on TV, press Resume at this play.'); };
  $('replay-resume').onclick = () => {
    const request = ++playRequest;
    audio.play().catch(() => { if (request === playRequest) message('Playback could not resume. Try the audio controls or official site.'); });
  };
  $('replay-stop').onclick = stop;
  function restoreBookmark() {
    if (!current || restorePosition === null) return;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
      if (playingStarted && failedRestoreAt === null) failedRestoreAt = audio.currentTime;
      return;
    }
    if (restorePosition >= audio.duration - 1) { audio.currentTime = 0; restorePosition = null; return; }
    if (restoreAttempts >= 2) { if (failedRestoreAt === null) failedRestoreAt = audio.currentTime; message('Your saved position could not be restored. Choose a position or keep listening to save your new progress.'); return; }
    try { ++restoreAttempts; audio.currentTime = restorePosition; }
    catch { if (restoreAttempts >= 2) failedRestoreAt = audio.currentTime; message('Your saved position could not be restored. Choose a position or keep listening to save your new progress.'); }
  }
  function verifyBookmark() {
    if (restorePosition === null) return;
    if (Math.abs(audio.currentTime - restorePosition) < 2) {
      if (!playingStarted) return;
      const position = restorePosition; restorePosition = null;
      message(`Resumed at your saved position (${Math.floor(position / 60)}:${String(Math.floor(position % 60)).padStart(2, '0')}).`);
    } else restoreBookmark();
  }
  // Native controls belong to the listener once metadata is available. A manual gesture
  // cancels a pending automatic seek so retries cannot fight a chosen position.
  for (const event of ['pointerdown', 'keydown']) audio.addEventListener(event, () => {
    if (audio.readyState >= 1) { restorePosition = null; failedRestoreAt = null; }
  });
  audio.addEventListener('loadedmetadata', restoreBookmark);
  audio.addEventListener('canplay', verifyBookmark);
  audio.addEventListener('seeked', verifyBookmark);
  audio.addEventListener('timeupdate', savePosition);
  audio.addEventListener('pause', savePosition);
  document.addEventListener('visibilitychange', savePosition);
  document.defaultView?.addEventListener('pagehide', savePosition);
  audio.addEventListener('playing', () => { playingStarted = true; if (restorePosition !== null) verifyBookmark(); else message('Playing recording. Pause at a distinctive play to match your TV replay.'); });
  audio.addEventListener('waiting', () => { if (current) message('Buffering recording…'); });
  audio.addEventListener('error', () => { if (current) message('This recording could not play. It may have moved or be restricted. Try the official site below.'); });
  audio.addEventListener('ended', () => message('Recording finished.'));
  async function load() {
    const mine = ++loadGeneration;
    $('archive-retry').disabled = true;
    try {
      const response = await fetch('./archive.json', { cache: 'no-cache', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error();
      const data = validateCatalog(await response.json());
      if (mine !== loadGeneration) return;
      catalog = data; catalogError = false; render();
    } catch { if (mine === loadGeneration) { catalogError = true; $('archive-note').textContent = 'The archive catalog could not load. Try again or visit the official site.'; } }
    finally { if (mine === loadGeneration) $('archive-retry').disabled = false; }
  }
  $('archive-retry').onclick = load;
  load();
}
