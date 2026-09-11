import { teams } from './teams.js';
import { filterReplays, seekReplay, stopReplay } from './replay.js';
export function setupArchive({ stopLive, selectedTeam }) {
  const $ = id => document.getElementById(id);
  const audio = $('replay-audio');
  let catalog = null, current = null, mode = 'live', loadGeneration = 0, catalogError = false, playRequest = 0;
  const message = text => { $('replay-status').textContent = text; };
  function stop() {
    ++playRequest; stopReplay(audio); current = null; $('replay-player').hidden = true;
  }
  function selectMode(next) {
    if (next === mode) return;
    mode = next;
    stopLive(); stop();
    for (const name of ['live', 'archive']) {
      $(`${name}-tab`).setAttribute('aria-selected', String(name === mode));
      $(`${name}-tab`).tabIndex = name === mode ? 0 : -1;
    }
    $('live-panel').hidden = mode !== 'live';
    $('archive-panel').hidden = mode !== 'archive';
    $('live-sidebar').hidden = mode !== 'live';
    if (mode === 'archive') { $('archive-team').value = selectedTeam(); render(true); }
  }
  for (const name of ['live', 'archive']) {
    $(`${name}-tab`).onclick = () => selectMode(name);
    $(`${name}-tab`).onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'live' : event.key === 'End' ? 'archive' : mode === 'live' ? 'archive' : 'live';
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
    if (reset) {
      stop(); $('archive-sport').value = ''; $('archive-year').value = '';
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
        stop(); current = item; $('replay-player').hidden = false;
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
      else message('Position adjusted. Check against the TV replay.');
    };
  });
  $('replay-hold').onclick = () => { ++playRequest; audio.pause(); message('Audio paused at the play. When you see it on TV, press Resume at this play.'); };
  $('replay-resume').onclick = () => {
    const request = ++playRequest;
    audio.play().catch(() => { if (request === playRequest) message('Playback could not resume. Try the audio controls or official site.'); });
  };
  $('replay-stop').onclick = stop;
  audio.addEventListener('playing', () => message('Playing recording. Pause at a distinctive play to match your TV replay.'));
  audio.addEventListener('waiting', () => { if (current) message('Buffering recording…'); });
  audio.addEventListener('error', () => { if (current) message('This recording could not play. It may have moved or be restricted. Try the official site below.'); });
  audio.addEventListener('ended', () => message('Recording finished.'));
  async function load() {
    const mine = ++loadGeneration;
    $('archive-retry').disabled = true;
    try {
      const response = await fetch('./archive.json', { cache: 'no-cache', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error();
      const data = await response.json();
      if (!data.schools || !data.checkedAt) throw Error();
      if (mine !== loadGeneration) return;
      catalog = data; catalogError = false; render(true);
    } catch { if (mine === loadGeneration) { catalogError = true; $('archive-note').textContent = 'The archive catalog could not load. Try again or visit the official site.'; } }
    finally { if (mine === loadGeneration) $('archive-retry').disabled = false; }
  }
  $('archive-retry').onclick = load;
  load();
}
