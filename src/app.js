import { setupSync } from './sync.js';
import { PlaybackMemory } from './playback-memory.js';
import { setupArchive } from './archive.js';
import { teams, getSources } from './teams.js';
import { setupHomestream } from './homestream-ui.js';
import { Player } from './player.js';
import { SessionLog } from './session-log.js';
import { demoURL } from './demo.js';
const $ = id => document.getElementById(id);
let storage;
try { storage = localStorage; } catch { /* Private browsing may deny access. */ }
const memory = new PlaybackMemory(storage, text => { $('storage-warning').textContent = text; });
let liveKey = null, savedDelay = null, sourcePaused = false;
let selected = 'duke';
try { if (teams[storage?.getItem('mystream.team')]) selected = storage.getItem('mystream.team'); } catch {}
let selectedSourceId = teams[selected].sourceId, resetSourceDelay = false;
let state = null, connecting = false, active = false, scrubbing = false, generation = 0, demo = null, pending = 0, specialPending = false;
let previewText = '', previewId = '', needsCheck = true, sourceStatus = 'Disconnected';
const build = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'development';
$('build').textContent = build;
const log = new SessionLog({ storage, build, onWarning: text => { $('storage-warning').textContent = text; } });
const notice = text => { $('notice').textContent = text; };
const player = new Player(update, event => {
  if (!active) return;
  if (event === 'source-reconnecting') connecting = true;
  if (['source-reconnected', 'source-reconnect-required', 'source-reconnect-exhausted'].includes(event)) connecting = false;
  if (event === 'source-paused') sourcePaused = true;
  if (event === 'source-playing') {
    sourceStatus = 'Receiving audio'; log.add(event, {}, state);
  } else {
    needsCheck = true; log.boundary(event, state);
    const messages = {
      'source-waiting': 'The source is buffering. Check alignment when it returns.',
      'source-stalled': 'The source stopped delivering data. Check alignment when it returns.',
      'source-paused': 'Your phone paused the source. Resume audio restores your saved delay; use the TV-paused option only if the picture stopped too.',
      'source-reconnecting': 'Connection lost. Reconnecting to the same source and refilling your saved delay…',
      'source-reconnected': 'Reconnected. Your saved delay is refilling; check alignment when audio returns.',
      'source-reconnect-required': 'Playback needs your permission to resume. Press Play to reconnect with your saved delay.',
      'source-reconnect-exhausted': 'The source could not reconnect after three attempts. Press Play to try again.',
      'source-ended': 'The source ended. Reconnect to start a fresh audio buffer.',
      'source-error': connectionHelp(),
      'context-restored': 'Phone audio returned. Restoring playback; check alignment.',
      'context-interrupted': 'Phone audio was interrupted. Press Resume audio, then check alignment.',
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
const catalog = setupHomestream({ onChange: disconnect, onReady: render });
function update(value) {
  if (value === null && active) {
    log.end(state); active = false; sourceStatus = 'Disconnected';
    if (demo) URL.revokeObjectURL(demo); demo = null;
    refreshSessions();
  }
  const wasRestoring = state?.restoring != null;
  state = value;
  if (state && active && state.ingesting && !state.paused && !state.holding && state.restoring == null) {
    if (!player.audio?.paused) sourcePaused = false;
    if (savedDelay === null || Math.abs(savedDelay - (state.resumeDelay ?? state.delay)) > 0.02) {
      savedDelay = state.resumeDelay ?? state.delay; if (liveKey) memory.save('live', liveKey, savedDelay);
    }
    if (wasRestoring) notice(`Restored your ${state.delay.toFixed(1)}-second delay. Check alignment with your TV.`);
  }
  render();
}
function render() {
  const ready = active && !!state && !connecting;
  const restoring = state?.restoring != null;
  const holding = !!state?.holding;
  const positionReady = ready && !restoring && player.context?.state === 'running';
  $('status').textContent = restoring ? `Restoring ${state.restoring.toFixed(1)}-second delay · ${Math.max(0, state.restoring - state.available).toFixed(0)} s of audio still needed` : connecting ? 'Connecting…' : sourceStatus;
  $('connect').textContent = active ? 'Reconnect audio' : `Play ${teams[selected].name} audio`;
  $('connect').disabled = connecting || (teams[selected].discovery === 'homestream' && !catalog.ready);
  $('stop').disabled = !active && !connecting;
  $('pause').disabled = !ready || (restoring && player.context?.state === 'running' && !player.audio?.paused) || holding || specialPending;
  $('pause').textContent = state?.paused || player.audio?.paused || player.context?.state !== 'running' ? 'Resume audio' : 'Pause audio';
  $('hold').disabled = !positionReady || specialPending || (!holding && (state.paused || !state.ingesting));
  $('hold').textContent = holding ? 'I see it on TV · resume audio' : 'I heard the play · hold audio';
  $('resume-position').hidden = !ready || state?.canResumePosition === false || !state?.paused || restoring || holding || state.delay >= state.available - 0.01;
  $('resume-position').disabled = specialPending;
  $('cancel').hidden = !holding;
  $('cancel').disabled = !positionReady || specialPending;
  $('sync-help').textContent = holding ? 'Audio is held while the buffer keeps filling. Tap when that same play appears on TV.' : 'When the call comes before the picture, tap as you hear a distinct play. Tap again when you see it on TV.';
  $('confirm').disabled = !ready || restoring || holding || state.paused || !state.ingesting || pending > 0 || player.context?.state !== 'running';
  $('alignment').textContent = log.confirmed && !needsCheck ? 'You marked it aligned' : 'Check alignment';
  $('scrub').disabled = !positionReady || holding || specialPending;
  $('live').disabled = !ready || player.context?.state !== 'running' || holding || specialPending;
  document.querySelectorAll('[data-nudge]').forEach(button => { button.disabled = !positionReady || holding || specialPending; });
  $('delay').textContent = (state?.delay || 0).toFixed(2);
  $('buffer').textContent = state ? `${state.available.toFixed(1)} s of history available · ${state.paused ? 'audio paused' : 'up to 180 s'}` : 'History fills as you listen · up to 3 minutes';
  if (!scrubbing) {
    $('scrub').max = state?.available || 0; $('scrub').value = state?.delay || 0;
    $('scrub-label').textContent = `${(state?.delay || 0).toFixed(2)} s`;
  }
  $('provider').disabled = $('output').disabled = active;
  for (const id of ['share', 'copy', 'download']) $(id).disabled = !previewText || pending > 0;
}
function currentSource() {
  return getSources(selected).find(source => source.sourceId === selectedSourceId);
}
function connectionHelp() {
  return getSources(selected).length > 1
    ? 'Audio could not play. Try Play again, choose another Audio feed above, or open the official player.'
    : 'Audio could not play. Try Play again or open the official player.';
}
function showSource() {
  const source = currentSource();
  $('station').textContent = source.station; $('official').href = source.official;
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
  document.documentElement.style.setProperty('--accent', team.color);
  $('feed').replaceChildren();
  for (const source of sources) {
    const option = document.createElement('option'); option.value = source.sourceId; option.textContent = source.label;
    $('feed').append(option);
  }
  $('feed').value = selectedSourceId; $('feed-picker').hidden = sources.length < 2;
  showSource(); notice(`Ready for ${team.name}. Keep this page open while listening.`); render();
}
function sourceChanged() {
  const id = $('feed').value;
  if (id === selectedSourceId || !getSources(selected).some(source => source.sourceId === id)) return;
  disconnect(); selectedSourceId = id; resetSourceDelay = true;
  showSource(); notice(`Ready for ${currentSource().station}. Press Play to start at 0 seconds, then check alignment.`); render();
}
function disconnect() {
  catalog.stop(); ++generation; sourcePaused = false; liveKey = null; savedDelay = null; log.end(state); player.stop();
  if (demo) URL.revokeObjectURL(demo); demo = null;
  state = null; active = connecting = false; pending = 0; specialPending = false;
  needsCheck = true; sourceStatus = 'Disconnected'; refreshSessions(); render();
}
async function connect(useDemo = false) {
  const game = teams[selected].discovery === 'homestream' && !useDemo ? catalog.ready : null;
  if (!useDemo && teams[selected].discovery === 'homestream') {
    if (active || !game) { await catalog.refresh(); return; }
  }
  disconnect(); const mine = generation;
  active = connecting = true;
  const team = teams[selected], source = currentSource();
  liveKey = useDemo ? null : game ? `${source.sourceId}:${game.id}` : source.sourceId;
  savedDelay = liveKey ? resetSourceDelay ? 0 : memory.read('live', liveKey)?.value ?? null : null;
  const restoreDelay = savedDelay ?? 0;
  log.start(selected, useDemo ? 'test-tone' : source.sourceId, useDemo ? 'demo' : 'live', $('provider').value, $('output').value);
  sourceStatus = 'Connecting'; notice('Connecting to the audio source…');
  $('station').textContent = useDemo ? 'Timing demo · repeating tones' : game ? `${team.name} vs ${game.opponent}` : source.station;
  refreshSessions(log.session.id); render();
  try {
    const url = useDemo ? (demo = demoURL()) : game ? game.url : source.url;
    if (!url) throw Error('gateway-unavailable');
    const started = player.start(url, restoreDelay, { hls: !!game });
    if (useDemo && player.audio) player.audio.loop = true;
    await started;
    if (mine !== generation) return;
    if (!useDemo) {
      if (resetSourceDelay && liveKey) memory.save('live', liveKey, 0);
      resetSourceDelay = false;
    }
    connecting = false; notice(restoreDelay > 0 && !useDemo ? `Restoring your saved ${restoreDelay.toFixed(1)}-second delay. Audio will resume when enough history is available; check alignment. Choose Jump to incoming audio to skip the wait.` : useDemo ? 'Demo only: a tone each second, higher every fifth. Try pause, delay and the two-tap match.' : 'Listen for a distinct play to match. If audio already trails TV, pause the TV.');
  } catch {
    if (mine !== generation) return;
    log.boundary('source-error', state); log.end(state);
    active = connecting = false; state = null; sourceStatus = 'Could not connect';
    notice(connectionHelp());
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
      if (!needsCheck) notice('Alignment marked. Check again after a break or interruption.');
    } else if (action === 'hold') notice('Now watch the TV. Tap again when that same play appears.');
    else if (action === 'complete') notice('Audio resumed at your sync point. Fine-tune if needed, then tap Sounds aligned.');
    else if (action === 'cancel') notice('Match canceled. Restored the delay you had before holding audio. Check alignment.');
    else if ((action === 'nudge' && value < 0 || action === 'live' || action === 'delay') && ack.after.delay < 0.01)
      notice('At incoming audio. If the call still trails the picture, pause your TV until it catches up.');
    else if ((action === 'nudge' && Math.abs(ack.after.delay - ack.before.delay - value) > 0.02) || (action === 'delay' && Math.abs(ack.after.delay - value) > 0.02))
      notice('Reached the available history limit. The log records the adjustment actually applied.');
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
$('feed').onchange = sourceChanged;
$('team').value = selected; $('team').onchange = teamChanged;
$('connect').onclick = () => connect(); $('demo').onclick = () => connect(true);
$('stop').onclick = () => { disconnect(); notice('Disconnected. Your saved logs are still available below.'); };
$('pause').onclick = () => {
  if ((sourcePaused && state?.paused) || player.context?.state !== 'running' || player.audio?.paused) return connect();
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
$('volume').oninput = () => player.setVolume(Number($('volume').value));
$('preview').onclick = preview; $('sessions').onchange = preview;
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
  $('clear-confirm').hidden = true; render();
};
document.addEventListener('visibilitychange', () => {
  if (!active) return;
  needsCheck = true; log.boundary(document.hidden ? 'hidden' : 'visible', state);
  if (document.hidden && state?.holding) player.command('invalidate').catch(() => {});
  if (!document.hidden) notice('Welcome back. Check playback and alignment after switching away.');
  render();
});
window.addEventListener('pagehide', () => { log.boundary('hidden', state); });
setInterval(() => { if (active && state) log.heartbeat(state, !document.hidden && player.context?.state === 'running'); }, 30000);
teamChanged(); refreshSessions(); render();

setupArchive({ stopLive: disconnect, selectedTeam: () => selected, memory, sync: setupSync({ initialSchool: () => teams[selected].name, stopLive: disconnect }) });
