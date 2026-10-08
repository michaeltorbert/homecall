import { metadataURL, configuredGatewayOrigin, gatewayOptions } from './gateway.js';
import { teams } from './teams.js';
import { catalogFreshness, filterReplays, seekReplay, stopReplay, validateCatalog } from './replay.js';
import { createConfirm } from './ui-shell.js';
export function setupArchive({ stopLive, selectedTeam, memory, sync = null, nowPlaying = null, liveActive = () => false, confirm = createConfirm(document), origin = configuredGatewayOrigin(), allowLocal = gatewayOptions().allowLocal, now = () => Date.now(), every = fn => document.defaultView?.setInterval(fn, 60_000) }) {
  const $ = id => document.getElementById(id);
  const audio = $('replay-audio');
  let replayKey = null, restorePosition = null, restoreAttempts = 0, playingStarted = false, failedRestoreAt = null, lastSaved = null;
  // Score-free recording identity. It stays through pause, end and error so native controls can
  // replay; stopping or replacing the recording releases it.
  let owner = null;
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
  // Recording errors are flagged so modal warning mirrors can show them; other messages are routine.
  const message = (text, alert = false) => { $('replay-status').textContent = text; $('replay-status').dataset.alert = alert ? 'on' : ''; };
  let committedSchool = 'duke';
  function stop() {
    confirm.cancel();
    // A departed recording's warning must not stay mirrored into tool dialogs.
    $('replay-status').dataset.alert = '';
    savePosition(); replayKey = null; restorePosition = null; ++playRequest; stopReplay(audio); current = null; $('replay-player').hidden = true;
    owner?.release(); owner = null;
  }
  // Two destinations: Listen (radio or game broadcasts, whichever was chosen last) and Recordings.
  // More → Radio stations / Game broadcasts choose the Listen view. Browsing never stops radio;
  // leaving an active broadcast or a loaded recording stops it, so that departure asks first.
  let listenMode = 'live';
  const tabs = ['listen', 'archive'], tabOf = name => (name === 'archive' ? 'archive' : 'listen');
  function selectMode(next, { force = false } = {}) {
    if (next === 'sync' && !sync) next = 'live';
    if (next === mode) return;
    const leavingBroadcast = mode === 'sync' && sync?.active, leavingRecording = mode === 'archive' && !!current;
    if (!force && (leavingBroadcast || leavingRecording)) {
      confirm.ask(leavingBroadcast ? { title: 'Stop this broadcast?', text: 'The game broadcast stops when you leave it. Radio does not start on its own.', action: 'Stop and leave' }
        : { title: 'Stop this recording?', text: 'The recording stops when you leave it. Your position is saved.', action: 'Stop and leave' },
        () => { selectMode(next, { force: true }); $(`${tabOf(mode)}-tab`).focus(); });
      return;
    }
    mode = next;
    if (mode !== 'archive') listenMode = mode;
    stop(); sync?.deactivate();
    for (const name of tabs) {
      $(`${name}-tab`).setAttribute('aria-selected', String(name === tabOf(mode)));
      $(`${name}-tab`).tabIndex = name === tabOf(mode) ? 0 : -1;
    }
    $('listen-tab').setAttribute('aria-controls', `${listenMode}-panel`);
    $('nav-radio')?.setAttribute('aria-current', String(mode === 'live'));
    $('nav-broadcasts')?.setAttribute('aria-current', String(mode === 'sync'));
    document.body.dataset.view = mode;
    $('live-panel').hidden = mode !== 'live';
    $('archive-panel').hidden = mode !== 'archive';
    if (sync) { $('sync-panel').hidden = mode !== 'sync'; if (mode === 'sync') sync.activate(); }
    if (mode === 'archive') { $('archive-team').value = [...$('archive-team').options].some(o => o.value === selectedTeam()) ? selectedTeam() : 'duke'; render(true); }
  }
  const choose = name => (name === 'archive' ? 'archive' : listenMode);
  for (const name of tabs) {
    $(`${name}-tab`).onclick = () => selectMode(choose(name));
    $(`${name}-tab`).onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(tabs.indexOf(name) + 1) % tabs.length];
      selectMode(choose(target));
      // Focus follows the selection; a pending departure prompt keeps focus in its dialog.
      if (!confirm.pending) $(`${tabOf(mode)}-tab`).focus();
    };
  }
  if ($('nav-radio')) $('nav-radio').onclick = () => selectMode('live');
  if ($('nav-broadcasts')) $('nav-broadcasts').onclick = () => selectMode('sync');
  if ($('owner-return')) $('owner-return').onclick = () => selectMode('live');
  $('nav-broadcasts')?.toggleAttribute('hidden', !sync);
  function options(id, values, label) {
    const previous = $(id).value;
    $(id).replaceChildren(new Option(label, ''), ...values.map(value => new Option(value, value)));
    if (values.includes(previous)) $(id).value = previous;
  }
  const age = at => ({ old: ' This list is more than 12 hours old; scheduled updates may have stopped.', unknown: ' Its freshness is unknown.' })[catalogFreshness(at, now())] || '';
  function note() {
    const key = $('archive-team').value, team = teams[key], source = catalog?.schools[key];
    if (!catalog) return catalogError ? 'The archive catalog could not load. Try again or visit the official site.' : 'Loading recordings…';
    // A failed reload keeps the list loaded earlier; say so until a current reload succeeds.
    const caveat = catalogError ? 'Refresh list could not reach the catalog; showing the list loaded earlier. ' : '';
    if (source?.status === 'unavailable') return `${caveat}We couldn’t refresh ${team.name}’s archive. Try the official site below.`;
    if (source?.status === 'external') return `${caveat}In-app recordings aren’t available for ${team.name} yet. Visit the official site for listening options.`;
    const all = source?.items || [], count = filterReplays(all, $('archive-sport').value, $('archive-year').value).length;
    if (source?.status === 'stale') {
      // A stale school's time is only its own last successful check, never the catalog's.
      const checked = source.checkedAt ? `Last checked ${new Date(source.checkedAt).toLocaleString()}.${age(source.checkedAt)}` : 'Last successful check time unknown.';
      if (!all.length) return `${caveat}The latest refresh failed. The last successful check found no recordings for ${team.name}. ${checked}`;
      return `${caveat}Showing previously checked recordings. The latest refresh failed.${count ? '' : ' No recordings match these filters.'} ${checked}`;
    }
    const at = source?.checkedAt || catalog.checkedAt, checked = `Catalog checked ${new Date(at).toLocaleString()}.${age(at)}`;
    if (!all.length) return `${caveat}No recordings are listed for ${team.name}. ${checked}`;
    if (!count) return `${caveat}No recordings match these filters. Try another sport or year. ${checked}`;
    return `${caveat}${count} recordings · ${checked} Scores are omitted; broadcaster titles may contain spoilers. Recordings may include pregame and postgame audio.`;
  }
  // Only the note changes here, never the list, filters or audio.
  function renderNote() {
    const text = note();
    if ($('archive-note').textContent !== text) $('archive-note').textContent = text;
  }
  every(() => { if (document.visibilityState !== 'hidden') renderNote(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') renderNote(); });
  function render(reset = false) {
    const key = $('archive-team').value, team = teams[key], source = catalog?.schools[key];
    $('archive-official').href = source?.source || team.official;
    if (reset) { stop(); committedSchool = key; $('archive-sport').value = ''; $('archive-year').value = ''; }
    {
      const items = source?.items || [];
      options('archive-sport', [...new Set(items.map(x => x.sport))].sort(), 'All sports');
      options('archive-year', [...new Set(items.map(x => x.start.slice(0, 4)))].sort().reverse(), 'All years');
    }
    const items = filterReplays(source?.items || [], $('archive-sport').value, $('archive-year').value);
    $('archive-list').replaceChildren();
    renderNote();
    for (const item of items) {
      const li = document.createElement('li'), button = document.createElement('button');
      const title = document.createElement('strong'), detail = document.createElement('span');
      title.textContent = `${team.name} · ${item.opponent}`;
      detail.textContent = `${item.sport} · ${new Date(item.start).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York' })} · ${item.kind}`;
      button.append(title, detail); button.setAttribute('aria-label', `Play ${title.textContent}, ${detail.textContent}`);
      // Playing a recording takes over from radio or from the recording already loaded (playing,
      // paused or ended), so either confirms first. Continue starts it inside its own click; a
      // button withdrawn by a list refresh does nothing.
      button.onclick = () => {
        const radio = liveActive();
        if (!radio && !current) return play();
        confirm.ask(radio ? { title: 'Play this recording?', text: 'Radio stops so the recording can play.', action: 'Play recording' }
          : { title: 'Replace the current recording?', text: 'The current recording stops; its position is saved.', action: 'Play recording' }, () => { if (button.isConnected) play(); });
      };
      const play = () => {
        stopLive(); stop(); current = item; replayKey = `${key}:${item.id}`; lastSaved = null; restoreAttempts = 0; playingStarted = false; failedRestoreAt = null; restorePosition = memory?.read('replay', replayKey)?.value ?? null; $('replay-player').hidden = false;
        owner = nowPlaying?.claim({ mode: 'archive', school: team.name, opponent: item.opponent }) ?? null;
        $('replay-title').textContent = title.textContent; $('replay-audio').src = item.url;
        audio.playbackRate = Number($('replay-speed').value);
        message('Loading recording…');
        const request = ++playRequest;
        audio.play().catch(() => { if (request === playRequest) message('Press Play in the audio controls. If playback fails, try the official site.', true); });
      };
      li.append(button); $('archive-list').append(li);
    }
  }
  // Changing school unloads a loaded recording, so it confirms first; the select keeps the
  // committed school until Continue, and Cancel leaves audio, bookmark, owner and filters alone.
  $('archive-team').onchange = () => {
    const next = $('archive-team').value;
    if (!current) return render(true);
    $('archive-team').value = committedSchool;
    confirm.ask({ title: 'Change school?', text: 'The current recording stops; its position is saved.', action: 'Change school' },
      () => { $('archive-team').value = next; render(true); });
  };
  $('archive-sport').onchange = $('archive-year').onchange = () => render();
  $('replay-speed').onchange = () => { audio.playbackRate = Number($('replay-speed').value); };
  document.querySelectorAll('[data-replay-seek]').forEach(button => {
    button.onclick = () => {
      if (!seekReplay(audio, Number(button.dataset.replaySeek))) message('Wait for the recording to load before adjusting its position.');
      else { restorePosition = null; savePosition(); message('Position adjusted. Check against the TV replay.'); }
    };
  });
  $('replay-hold').onclick = () => { ++playRequest; audio.pause(); message('Audio paused at the play. When you see it on TV, press Resume here.'); };
  $('replay-resume').onclick = () => {
    const request = ++playRequest;
    audio.play().catch(() => { if (request === playRequest) message('Playback could not resume. Try the audio controls or official site.', true); });
  };
  $('replay-stop').onclick = stop;
  function restoreBookmark() {
    if (!current || restorePosition === null) return;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
      if (playingStarted && failedRestoreAt === null) failedRestoreAt = audio.currentTime;
      return;
    }
    if (restorePosition >= audio.duration - 1) { audio.currentTime = 0; restorePosition = null; return; }
    if (restoreAttempts >= 2) { if (failedRestoreAt === null) failedRestoreAt = audio.currentTime; message('Your saved position could not be restored. Choose a position or keep listening to save your new progress.', true); return; }
    try { ++restoreAttempts; audio.currentTime = restorePosition; }
    catch { if (restoreAttempts >= 2) failedRestoreAt = audio.currentTime; message('Your saved position could not be restored. Choose a position or keep listening to save your new progress.', true); }
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
  audio.addEventListener('error', () => { if (current) message('This recording could not play. It may have moved or be restricted. Try the official site below.', true); });
  audio.addEventListener('ended', () => message('Recording finished.'));
  async function load() {
    const mine = ++loadGeneration;
    $('archive-retry').disabled = true;
    try {
      const response = await fetch(metadataURL('catalog/archive', document.baseURI, origin, { allowLocal, required: true }), { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error();
      const data = validateCatalog(await response.json(), { origin, allowLocal });
      if (mine !== loadGeneration) return;
      catalog = data; catalogError = false; render();
    } catch { if (mine === loadGeneration) { catalogError = true; renderNote(); } }
    finally { if (mine === loadGeneration) $('archive-retry').disabled = false; }
  }
  $('archive-retry').onclick = load;
  load();
  // force skips the departure prompt for callers that already confirmed (the test-tone dialog).
  return { select: selectMode, get mode() { return mode; } };
}
