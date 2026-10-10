import { setupSync } from './sync.js';
import { PlaybackMemory } from './playback-memory.js';
import { setupArchive } from './archive.js';
import { teams, getSources } from './teams.js';
import { setupHomestream } from './homestream-ui.js';
import { Player } from './player.js';
import { SessionLog } from './session-log.js';
import { demoURL } from './demo.js';
import { createNowPlaying, nowPlayingArtwork } from './now-playing.js';
import { createScoreboard } from './scoreboard.js';
import { readJSON } from './homestream.js';
import { metadataURL, configuredGatewayOrigin, gatewayOptions } from './gateway.js';
import { setupShell, createConfirm, setDisclosure, closeDialog } from './ui-shell.js';
const $ = id => document.getElementById(id);
let storage;
try { storage = localStorage; } catch { /* Private browsing may deny access. */ }
const memory = new PlaybackMemory(storage, text => { $('storage-warning').textContent = text; });
let liveKey = null, savedDelay = null, sourcePaused = false;
let selected = 'duke';
try { if (teams[storage?.getItem('mystream.team')]) selected = storage.getItem('mystream.team'); } catch {}
let selectedSourceId = teams[selected].sourceId, resetSourceDelay = false;
let state = null, connecting = false, active = false, scrubbing = false, generation = 0, demo = null, pending = 0, specialPending = false;
let previewText = '', previewId = '', needsCheck = true, sourceStatus = 'Stopped', attention = false;
let nav = null, sync = null;
const build = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'development';
$('build').textContent = build;
const log = new SessionLog({ storage, build, onWarning: text => { $('storage-warning').textContent = text; } });
const notice = text => { $('notice').textContent = text; };
// One prompt for every takeover, departure and destructive refresh across Live, Sync and Archive.
const ask = createConfirm(document);
// One application-wide Now Playing publisher; Live, Sync and Archive each claim it on playback start.
const nowPlaying = createNowPlaying({ mediaSession: navigator.mediaSession, MediaMetadata: window.MediaMetadata, artwork: nowPlayingArtwork(document.baseURI) });
const scoreboard = () => createScoreboard({ read: (path, options) => readJSON(metadataURL(path, document.baseURI, configuredGatewayOrigin(), gatewayOptions()), options), window, document,
  setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: timer => clearTimeout(timer), setTicker: (fn, ms) => setInterval(fn, ms), clearTicker: timer => clearInterval(timer) });
const liveBoard = scoreboard();
let liveOwner = null, liveCatalog = null;
// Volatile game data follows actual PCM output, not input ingestion or the selected view, and
// stops as soon as another session owns Now Playing.
const livePlaying = () => !!liveOwner?.current && active && !connecting && !!state && player.context?.state === 'running' && player.sourceConnected && !player.sourcePaused &&
  !sourcePaused && !state.paused && !state.holding && state.restoring == null;
function releaseLive() { liveBoard.stop(); liveOwner?.release(); liveOwner = null; }
// Events that need the listener's attention; they stay visible while browsing other views.
const ATTENTION = new Set(['source-stalled', 'source-paused', 'source-reconnecting', 'source-reconnect-required', 'source-reconnect-exhausted', 'source-ended', 'source-error',
  'context-interrupted', 'engine-error', 'control-overflow', 'command-timeout', 'resume-failed', 'buffer-overrun']);
// Recovery replacement and terminal failures make any pending prompt about this session stale.
const TERMINAL = new Set(['source-reconnecting', 'source-reconnect-required', 'source-reconnect-exhausted', 'source-error', 'engine-error', 'control-overflow', 'command-timeout', 'resume-failed']);
const player = new Player(update, event => {
  if (!active) return;
  if (event === 'source-reconnecting') connecting = true;
  if (['source-reconnected', 'source-reconnect-required', 'source-reconnect-exhausted'].includes(event)) connecting = false;
  if (event === 'source-paused') sourcePaused = true;
  if (TERMINAL.has(event)) ask.cancel();
  if (ATTENTION.has(event)) attention = true;
  else if (['source-playing', 'source-reconnected', 'context-restored'].includes(event)) attention = false;
  if (event === 'source-playing') {
    sourceStatus = 'Receiving audio'; log.add(event, {}, state);
  } else {
    needsCheck = true; log.boundary(event, state);
    const messages = {
      'source-waiting': 'The source is buffering. Check alignment when it returns.',
      'source-stalled': 'The source stopped delivering data. Check alignment when it returns.',
      'source-paused': 'Your phone paused the source. Resume restores your saved delay; use Resume at paused position only if the TV paused too.',
      'source-reconnecting': 'Connection lost. Reconnecting to the same source and refilling your saved delay…',
      'source-reconnected': 'Reconnected. Your saved delay is refilling; check alignment when audio returns.',
      'source-reconnect-required': 'Playback needs your permission to resume. Press Play to reconnect with your saved delay.',
      'source-reconnect-exhausted': 'The source could not reconnect after three attempts. Press Play to try again.',
      'source-ended': 'The source ended. Reconnect to start a fresh audio buffer.',
      'source-error': connectionHelp(),
      'context-restored': 'Phone audio returned. Restoring playback; check alignment.',
      'context-interrupted': 'Phone audio was interrupted. Press Resume, then check alignment.',
      'engine-error': 'The audio engine stopped. Reconnect to start a fresh buffer.',
      'control-overflow': 'Audio disconnected after too many pending source events. Press Play to reconnect.',
      'command-timeout': 'Audio disconnected because a timing change could not be confirmed. Reconnect to begin with a fresh buffer.',
      'resume-failed': 'Audio could not resume. Reconnect when your phone is ready for playback.',
      'buffer-overrun': 'The held audio reached the 3-minute limit. Playback is paused; choose a new sync point.'
    };
    sourceStatus = event === 'buffer-overrun' ? 'Buffer limit reached' : 'Check playback';
    notice(messages[event] || 'Playback changed. Check alignment.');
  }
  render();
});
const catalog = setupHomestream({ onChange: disconnect, onReady: render, guard: liveGuard,
  onGames: (games, { teamId }) => { liveCatalog = { games, teamId }; }, onCatalogInvalidated: () => { liveCatalog = null; } });
// Changing or refreshing the selected game stops an active session; confirm before that happens.
function liveGuard(kind, proceed, revert) {
  if (!active && !connecting) return proceed();
  revert?.();
  ask.ask(kind === 'game' ? { title: 'Change game?', text: 'Audio stops. Your delay and TV alignment do not transfer to another game.', action: 'Change game' }
    : { title: 'Refresh games?', text: 'Refreshing the game list stops this broadcast. Press Play again when the feed is ready.', action: 'Refresh' }, proceed);
}
function update(value) {
  if (value === null && active) {
    ask.cancel();
    releaseLive(); log.end(state); active = false; sourceStatus = 'Disconnected';
    if (demo) URL.revokeObjectURL(demo); demo = null;
    refreshSessions();
  }
  const wasRestoring = state?.restoring != null;
  state = value;
  if (state && active && state.ingesting && !state.paused && !state.holding && state.restoring == null) {
    if (!player.sourcePaused) sourcePaused = false;
    if (savedDelay === null || Math.abs(savedDelay - (state.resumeDelay ?? state.delay)) > 0.02) {
      savedDelay = state.resumeDelay ?? state.delay; if (liveKey) memory.save('live', liveKey, savedDelay);
    }
    if (wasRestoring) notice(`Restored your ${state.delay.toFixed(1)}-second delay. Check alignment with your TV.`);
  }
  render();
}
// Restoring wins, then connecting, interruption, hold and pause. Playing requires actual
// output (running context, unpaused element and engine); input receipt alone never says Playing.
function primaryStatus() {
  if (state?.restoring != null) return `Restoring ${state.restoring.toFixed(1)}-second delay · ${Math.max(0, state.restoring - state.available).toFixed(0)} s of audio still needed`;
  if (connecting) return 'Connecting…';
  if (!active) return sourceStatus;
  if (!state) return 'Connecting…';
  // Without both a source and an audio context there is no output to call Playing.
  if (!player.sourceConnected || !player.context) return 'Check playback';
  if (player.context.state !== 'running') return 'Interrupted';
  if (state.holding) return 'Paused for TV';
  if (state.paused || sourcePaused || player.sourcePaused) return sourceStatus === 'Buffer limit reached' ? 'Paused · buffer limit reached' : 'Paused';
  return sourceStatus === 'Check playback' ? 'Playing · check playback' : 'Playing';
}
function render() {
  const ready = active && !!state && !connecting;
  const restoring = state?.restoring != null;
  const holding = !!state?.holding;
  const positionReady = ready && !restoring && player.context?.state === 'running';
  // Hold exits stay usable while a restore is in progress so a hold can never be stranded.
  const holdExitReady = ready && player.context?.state === 'running' && !specialPending;
  $('status').textContent = primaryStatus();
  $('connect').textContent = active ? 'Reconnect' : 'Play';
  $('connect').hidden = active;
  $('connect').disabled = connecting || (teams[selected].discovery === 'homestream' && !catalog.ready);
  $('stop').disabled = !active && !connecting;
  $('pause').hidden = !active;
  $('pause').disabled = !ready || (restoring && player.context?.state === 'running' && !player.sourcePaused) || holding || specialPending;
  $('pause').textContent = holding ? 'Paused' : state?.paused || player.sourcePaused || player.context?.state !== 'running' ? 'Resume' : 'Pause';
  $('hold').disabled = holding ? !holdExitReady : !positionReady || specialPending || state.paused || !state.ingesting;
  $('hold').textContent = holding ? 'Resume with this delay' : 'Pause to match TV';
  $('resume-position').hidden = !ready || state?.canResumePosition === false || !state?.paused || restoring || holding || state.delay >= state.available - 0.01;
  $('resume-position').disabled = specialPending;
  $('resume-position-row').hidden = $('resume-position').hidden;
  $('cancel').hidden = !holding;
  $('cancel').disabled = !holdExitReady;
  // Matching stays open for the whole hold; Close returns once the hold ends.
  if (holding) setDisclosure(document, 'matching', true);
  $('match-close').hidden = holding;
  $('adjust-area').hidden = holding;
  $('sync-help').textContent = holding ? 'When the TV reaches what you just heard, resume. The buffer keeps filling while audio is held.' : 'Call ahead of the picture? Pause at a distinct play, then resume when the TV shows it.';
  $('confirm').disabled = !ready || restoring || holding || state.paused || !state.ingesting || pending > 0 || player.context?.state !== 'running';
  $('confirm').textContent = log.confirmed && !needsCheck ? '✓ Marked aligned' : 'Sounds aligned';
  $('alignment').textContent = log.confirmed && !needsCheck ? 'You marked it aligned' : 'Check alignment';
  $('scrub').disabled = !positionReady || holding || specialPending;
  $('live').disabled = !ready || player.context?.state !== 'running' || holding || specialPending;
  document.querySelectorAll('[data-nudge]').forEach(button => { button.disabled = !positionReady || holding || specialPending; });
  $('delay').textContent = (state?.delay || 0).toFixed(2);
  $('buffer').textContent = state ? `${state.available.toFixed(0)} s available${state.paused ? ' · audio paused' : ''}` : 'History fills as you listen';
  if (!scrubbing) {
    $('scrub').max = state?.available || 0; $('scrub').value = state?.delay || 0;
    $('scrub-label').textContent = `${(state?.delay || 0).toFixed(2)} s`;
  }
  $('provider').disabled = $('output').disabled = active;
  $('context-lock').hidden = !active;
  for (const id of ['share', 'copy', 'download']) $(id).disabled = !previewText || pending > 0;
  // Attention messages are flagged for the browsing strip and modal mirrors; the notice stays the only writer.
  $('notice').classList.toggle('attention', attention);
  if ($('notice').dataset.alert !== (attention ? 'on' : '')) $('notice').dataset.alert = attention ? 'on' : '';
  $('recovery-actions').hidden = !attention || connecting;
  $('recover-reconnect').textContent = active ? 'Reconnect' : 'Try again';
  $('recover-reconnect').disabled = $('connect').disabled;
  // The radio owner stays reachable from Game broadcasts and Recordings, including its last error.
  $('owner-strip').hidden = !(active || connecting || attention);
  $('owner-name').textContent = $('station').textContent;
  $('owner-state').textContent = $('status').textContent;
  $('owner-stop').disabled = !active && !connecting;
  liveBoard.check();
}
function currentSource() {
  return getSources(selected).find(source => source.sourceId === selectedSourceId);
}
function connectionHelp() {
  return getSources(selected).length > 1
    ? 'Audio could not play. Try Play again, choose another source above, or open the official player.'
    : 'Audio could not play. Try Play again or open the official player.';
}
function showSource() {
  const source = currentSource();
  $('station').textContent = source.station; $('official').href = $('recover-official').href = source.official;
  $('source-note').textContent = source.note || (source.discovery === 'homestream' ? 'Choose a published game feed. Availability is checked before Play. Reconnect refreshes the catalog; press Play again when ready. Delay controls work on incoming audio, just like the other teams.' : source.sourceId !== teams[selected].sourceId
    ? 'Duke affiliate station. Game and postgame coverage can change; check that you hear the broadcast you want.'
    : selected === 'miami' ? 'WQAM’s live station stream. Scheduled games may be subject to streaming rights and location restrictions; station audio does not prove the game is on air.'
    : 'Live network channel. Game coverage depends on the broadcaster; an empty or expired schedule does not disable this channel.');
}
function teamChanged() {
  disconnect(); selected = $('team').value;
  selectedSourceId = teams[selected].sourceId; resetSourceDelay = false;
  try { storage?.setItem('mystream.team', selected); } catch {}
  const team = teams[selected], sources = getSources(selected);
  catalog.setEnabled(team.discovery === 'homestream');
  $('feed').replaceChildren();
  for (const source of sources) {
    // Short visible label; the complete source description stays as the option's title.
    const option = document.createElement('option'); option.value = source.sourceId; option.textContent = sourceLabel(source); option.title = source.label;
    $('feed').append(option);
  }
  $('feed').value = selectedSourceId; $('feed-picker').hidden = sources.length < 2;
  showSource(); notice(''); render();
}
// Primary network, the network's alternate connection, or the affiliate station's call sign.
function sourceLabel(source) {
  if (source.sourceId === teams[selected].sourceId) return 'Network';
  return source.label.startsWith(`${teams[selected].name} network`) ? 'Network backup' : `${source.label.split(' · ')[0]} backup`;
}
function sourceChanged() {
  const id = $('feed').value;
  if (id === selectedSourceId || !getSources(selected).some(source => source.sourceId === id)) return;
  disconnect(); selectedSourceId = id; resetSourceDelay = true;
  showSource(); notice(`Ready for ${currentSource().station}. Press Play to start at 0 seconds.`); render();
}
function disconnect() {
  ask.cancel();
  releaseLive(); catalog.stop(); ++generation; sourcePaused = false; liveKey = null; savedDelay = null; log.end(state); player.stop();
  if (demo) URL.revokeObjectURL(demo); demo = null;
  state = null; active = connecting = false; pending = 0; specialPending = false; attention = false;
  needsCheck = true; sourceStatus = 'Stopped'; refreshSessions(); render();
}
async function connect(useDemo = false) {
  const game = teams[selected].discovery === 'homestream' && !useDemo ? catalog.ready : null;
  if (!useDemo && teams[selected].discovery === 'homestream') {
    // Reconnecting a game refreshes its catalog, which stops audio until Play is pressed again.
    if (active) {
      ask.ask({ title: 'Reconnect this broadcast?', text: 'The game list refreshes and audio stops. Press Play again when the feed is ready.', action: 'Reconnect' }, () => { catalog.refresh(); });
      return;
    }
    if (!game) { await catalog.refresh(); return; }
  }
  disconnect(); const mine = generation;
  active = connecting = true;
  const team = teams[selected], source = currentSource();
  liveKey = useDemo ? null : game ? `${source.sourceId}:${game.id}` : source.sourceId;
  savedDelay = liveKey ? resetSourceDelay ? 0 : memory.read('live', liveKey)?.value ?? null : null;
  const restoreDelay = savedDelay ?? 0;
  log.start(selected, useDemo ? 'test-tone' : source.sourceId, useDemo ? 'demo' : 'live', $('provider').value, $('output').value);
  sourceStatus = 'Connecting'; notice('');
  $('station').textContent = useDemo ? 'Timing demo · repeating tones' : game ? `${team.name} vs ${game.opponent}` : source.station;
  // Identity is frozen at the playback intent. Radio is never guessed into a game, so only a
  // catalog-bound game can add a scoreboard.
  const owner = liveOwner = nowPlaying.claim(useDemo ? { mode: 'demo', title: 'Timing demo · repeating tones' }
    : game ? { mode: 'game', school: team.name, opponent: game.opponent, album: source.station } : { mode: 'live', school: team.name, title: source.station });
  if (game && liveCatalog && nowPlaying.supported) liveBoard.start({ teamId: liveCatalog.teamId, school: team.name, game, games: liveCatalog.games, eligible: livePlaying, onUpdate: snapshot => owner.update(snapshot) });
  refreshSessions(log.session.id); render();
  try {
    const url = useDemo ? (demo = demoURL()) : game ? game.url : source.url;
    if (!url) throw Error('gateway-unavailable');
    // Only the verified audio/mpeg Duke primary is decoded into the delay engine; other stations,
    // demo tones and game HLS keep the media element until their formats are verified.
    const started = player.start(url, restoreDelay, { hls: !!game, mp3: !game && !useDemo && source.sourceId === 'duke-leanstream' });
    if (useDemo && player.audio) player.audio.loop = true;
    await started;
    if (mine !== generation) return;
    if (!useDemo) {
      if (resetSourceDelay && liveKey) memory.save('live', liveKey, 0);
      resetSourceDelay = false;
    }
    connecting = false; notice(restoreDelay > 0 && !useDemo ? `Restoring your saved ${restoreDelay.toFixed(1)}-second delay. Use Incoming audio in Match my TV to skip the wait.` : useDemo ? 'Test tone: a beep each second, higher every fifth.' : '');
  } catch (error) {
    if (mine !== generation) return;
    releaseLive(); log.boundary('source-error', state); log.end(state);
    active = connecting = false; state = null; sourceStatus = 'Could not connect'; attention = true;
    notice(error?.message === 'mp3-unsupported' ? 'This browser could not load the radio audio decoder. Open the official player instead.' : connectionHelp());
    refreshSessions();
    if (game) { await catalog.refresh(); return; }
  }
  render();
}
async function command(action, value) {
  const mine = generation;
  if (!active || !state) return;
  const special = ['pause', 'hold', 'complete', 'cancel', 'confirm', 'restore'].includes(action);
  if (specialPending || (special && pending)) return;
  pending++; if (special) specialPending = true;
  if (action !== 'confirm') needsCheck = true;
  render();
  try {
    if (action === 'pause' && !value) await player.resumeContext();
    if (mine !== generation) return;
    log.request(action, value, player.sequence + 1, player.epoch, $('reason').value, state);
    const ack = await player.command(action === 'confirm' ? 'snapshot' : action, value);
    if (mine !== generation) return;
    log.acknowledge(action, ack);
    if (ack.result !== 'applied') { notice('That control is not available in the current playback state.'); return; }
    if (['nudge', 'delay', 'live', 'complete', 'cancel'].includes(action) && Number.isFinite(ack.after.delay)) {
      savedDelay = ack.after.resumeDelay ?? ack.after.delay;
      if (liveKey) memory.save('live', liveKey, savedDelay);
    }
    if (action === 'confirm') {
      needsCheck = !log.confirm({ ...ack.after, contextSeconds: ack.contextSeconds }, $('reason').value);
      // The button itself shows "✓ Marked aligned"; no duplicate caption.
      if (!needsCheck) notice('');
    } else if (action === 'hold') notice('');
    else if (action === 'complete') notice('Resumed with this delay. Fine-tune if needed.');
    else if (action === 'cancel') notice('Match canceled. Previous delay restored.');
    else if ((action === 'nudge' && value < 0 || action === 'live' || action === 'delay') && ack.after.delay < 0.01)
      notice('At incoming audio. If the call still trails the picture, pause your TV until it catches up.');
    else if ((action === 'nudge' && Math.abs(ack.after.delay - ack.before.delay - value) > 0.02) || (action === 'delay' && Math.abs(ack.after.delay - value) > 0.02))
      notice('Reached the available history limit; a smaller change was applied.');
  } catch {
    if (mine === generation) { log.boundary('command-failed', state); notice(player.context ? 'That change could not be confirmed. Check playback or reconnect.' : 'Audio disconnected because the change could not be confirmed. Press Play to reconnect.'); }
  } finally {
    if (mine === generation) { pending--; if (special) specialPending = false; render(); }
  }
}
function refreshSessions(preferred) {
  const selectedId = preferred || $('sessions').value;
  $('sessions').replaceChildren();
  const records = log.list();
  for (const s of records) {
    const option = document.createElement('option'); option.value = s.id;
    option.textContent = `${teams[s.team]?.name || 'Unknown'} · ${s.mode === 'demo' ? 'demo · ' : ''}${new Date(s.startedAt).toLocaleString()}`;
    $('sessions').append(option);
  }
  if (records.some(s => s.id === selectedId)) $('sessions').value = selectedId;
  if ($('sessions').value !== previewId) {
    previewText = ''; $('export').value = ''; $('log-summary').textContent = '';
  }
  if (!records.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'No sessions yet'; $('sessions').append(option); }
}
function preview() {
  if (pending) { $('share-status').textContent = 'Wait for the timing change to finish, then refresh the log.'; return; }
  refreshSessions(); previewId = $('sessions').value;
  previewText = log.export(previewId) || '';
  $('export').value = previewText;
  if (previewText) {
    const s = JSON.parse(previewText);
    $('log-summary').textContent = `${s.events.length} recorded events · ${s.confirmedEpisodes} confirmed adjustment episodes · ${Math.round(s.userConfirmedObservedSeconds)} s observed after your alignment marks. ${s.truncatedEvents ? `${s.truncatedEvents} older events omitted. ` : ''}${s.status === 'last-saved-unclosed' ? 'Last saved snapshot; session did not close cleanly. ' : ''}This is not a measurement of true TV delay.`;
    $('share-status').textContent = 'This exact preview will be shared. Refresh it to include later adjustments.';
  } else $('log-summary').textContent = 'Start a listening session to create a log.';
  render();
}
// A team or source change stops an active session. The select keeps the committed choice until
// Continue, so Cancel leaves audio, buffer, log and stored delay untouched.
$('feed').onchange = () => {
  const next = $('feed').value;
  if (!active && !connecting) return sourceChanged();
  $('feed').value = selectedSourceId;
  ask.ask({ title: 'Change source?', text: 'Audio stops. The new source starts at 0 seconds; check alignment again.', action: 'Change source' }, () => { $('feed').value = next; sourceChanged(); });
};
$('team').value = selected;
$('team').onchange = () => {
  const next = $('team').value;
  if (!active && !connecting) return teamChanged();
  $('team').value = selected;
  ask.ask({ title: 'Change team?', text: 'Audio stops. Your current delay and TV alignment do not transfer.', action: 'Change team' }, () => { $('team').value = next; teamChanged(); });
};
$('connect').onclick = () => connect();
$('recover-reconnect').onclick = () => connect();
// The tone dialog is the takeover prompt: leave any broadcast or recording, then start the real demo.
$('demo').onclick = () => { closeDialog($('tone-dialog')); nav?.select('live', { force: true }); connect(true); };
$('stop').onclick = $('owner-stop').onclick = () => { disconnect(); notice(''); };
$('menu-reconnect').onclick = () => {
  if (active && !connecting) connect();
  else if (sync?.active) $('sync-play').click();
};
$('pause').onclick = () => {
  if ((sourcePaused && state?.paused) || player.context?.state !== 'running' || player.sourcePaused) return connect();
  if (state?.paused) return command('restore', savedDelay ?? 0);
  command('pause', true);
};
$('resume-position').onclick = () => { sourcePaused = false; command('pause', false); };
$('hold').onclick = () => command(state?.holding ? 'complete' : 'hold');
$('cancel').onclick = () => command('cancel'); $('confirm').onclick = () => command('confirm');
$('live').onclick = () => command('live');
document.querySelectorAll('[data-nudge]').forEach(button => { button.onclick = () => command('nudge', Number(button.dataset.nudge)); });
$('scrub').onpointerdown = () => { scrubbing = true; };
$('scrub').oninput = () => { scrubbing = true; $('scrub-label').textContent = `${Number($('scrub').value).toFixed(2)} s`; };
$('scrub').onchange = () => { const value = Number($('scrub').value); scrubbing = false; command('delay', value); };
$('scrub').onpointerup = () => { setTimeout(() => { scrubbing = false; render(); }, 0); };
$('scrub').onblur = $('scrub').onpointercancel = () => { scrubbing = false; render(); };
$('volume').oninput = () => { player.setVolume(Number($('volume').value)); $('volume-value').textContent = `${Math.round(Number($('volume').value) * 100)}%`; };
$('preview').onclick = preview; $('sessions').onchange = preview;
$('menu-logs').onclick = () => refreshSessions();
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(previewText); $('share-status').textContent = 'Copied the complete log. Paste it into your email or message.'; }
  catch { $('export').focus(); $('export').select(); $('share-status').textContent = 'Select and copy the log text above; clipboard access was unavailable.'; }
};
$('download').onclick = () => {
  const url = URL.createObjectURL(new Blob([previewText], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `homecall-${previewId}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  $('share-status').textContent = 'Download requested. Check your browser’s downloads or save menu.';
};
$('share').onclick = async () => {
  const file = new File([previewText], `homecall-${previewId}.json`, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ title: 'Homecall test log', files: [file] });
    else if (navigator.share) await navigator.share({ title: 'Homecall test log', text: previewText });
    else { $('share-status').textContent = 'This browser has no share menu. Use Copy or Download instead.'; return; }
    $('share-status').textContent = 'Handed the log to your share app. Your saved copy remains here.';
  } catch (error) { $('share-status').textContent = error.name === 'AbortError' ? 'Sharing canceled. Your log is still saved.' : 'Sharing was unavailable. Use Copy or Download instead.'; }
};
$('clear').onclick = () => {
  if (active) { $('share-status').textContent = 'Stop playback before removing saved logs.'; return; }
  $('clear-confirm').hidden = false;
};
$('clear-confirm').onclick = () => {
  if (log.clear()) { previewText = ''; $('export').value = ''; $('log-summary').textContent = ''; refreshSessions(); $('share-status').textContent = 'Saved logs removed.'; }
  else $('share-status').textContent = active ? 'Stop playback before removing saved logs.' : 'Saved logs could not be removed. They remain in this browser; see the storage warning.';
  $('clear-confirm').hidden = true; render();
};
document.addEventListener('visibilitychange', () => {
  if (!active) return;
  needsCheck = true; log.boundary(document.hidden ? 'hidden' : 'visible', state);
  if (document.hidden && state?.holding) player.command('invalidate').catch(() => {});
  if (!document.hidden) notice('Back from another app. Check alignment.');
  render();
});
window.addEventListener('pagehide', () => { log.boundary('hidden', state); });
setInterval(() => { if (active && state) log.heartbeat(state, !document.hidden && player.context?.state === 'running'); }, 30000);
setupShell({ doc: document, onMenuOpen: () => { $('menu-reconnect').disabled = !((active && !connecting) || sync?.active); } });
teamChanged(); refreshSessions(); render();

const liveActive = () => active || connecting;
sync = setupSync({ initialSchool: () => teams[selected].name, stopLive: disconnect, liveActive, confirm: ask, nowPlaying, scoreboard: scoreboard() });
nav = setupArchive({ stopLive: disconnect, liveActive, confirm: ask, selectedTeam: () => selected, memory, nowPlaying, sync }) ?? null;
