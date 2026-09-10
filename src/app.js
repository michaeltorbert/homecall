import workletURL from './audio-worklet.js?worker&url';
import { RadioIndexer } from './indexer.js';
import { playbackTarget } from './automatic-sync.js';
import { startScoreboardCamera } from './scoreboard.js';
const $ = id => document.getElementById(id);
let context, stream, node, gain, source, media, objectURL, demoTimer;
let schedule, selectedBroadcast, indexer, stopCamera, cameraAbort, syncGeneration=0;
let liveTime=0,pendingSync=null,appliedSync=null;
let delay = 0, available = 0, paused = false, aligning = false, previousDelay = 0, busy = false;
const controls = ['pause', 'live', 'earlier', 'later', 'align', 'stop', 'auto-sync'];
const sources = ['connect', 'demo', 'file', 'duke-play'];
function notice(message) { $('notice').textContent = message; }
function update() {
  $('delay').textContent = delay.toFixed(2);
  $('pause').textContent = paused ? 'Resume audio' : 'Pause audio';
  $('state').textContent = node ? (paused ? 'Paused · buffering' : 'Playing') : 'Not connected';
  $('state').classList.toggle('active', Boolean(node));
  $('align').textContent = aligning ? 'I see it on TV — resume' : 'I heard the play';
  $('cancel-align').hidden = !aligning;
  for (const id of ['pause', 'live', 'earlier', 'later']) $(id).disabled = !node || aligning;
  $('buffer-status').textContent = node ? `${available.toFixed(0)} seconds of audio available · 180 second maximum` : 'Up to 3 minutes of audio held on this device.';
}
function setPaused(value) { paused = value; node?.port.postMessage({ type: 'pause', value }); update(); }
function setDelay(value) {
  if (!node) return;
  const requested = Math.max(0, Math.min(available, value));
  node.port.postMessage({ type: 'delay', value: requested });
  delay = requested;
  update();
}
async function disconnect() {
  await stopAnalysis();
  clearInterval(demoTimer);
  if (stream) for (const track of stream.getTracks()) { track.onended = null; track.stop(); }
  if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
  source?.disconnect(); node?.disconnect(); gain?.disconnect();
  const oldContext = context;
  context = stream = node = gain = source = media = null;
  selectedBroadcast=null;
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = null;
  delay = available = liveTime = 0; paused = aligning = false;
  controls.forEach(id => $(id).disabled = true);
  $('source-name').textContent = 'Connect Duke radio';
  update();
  if (oldContext && oldContext.state !== 'closed') await oldContext.close();
}
async function prepare() {
  context = new AudioContext({ latencyHint: 'interactive' });
  await context.resume();
  await context.audioWorklet.addModule(workletURL);
  node = new AudioWorkletNode(context, 'broadcast-buffer', { outputChannelCount: [2] });
  gain = context.createGain(); gain.gain.value = Number($('volume').value);
  node.connect(gain).connect(context.destination);
  const activeNode=node;
  node.port.onmessage = ({ data }) => {
    if(node!==activeNode) return;
    if(data.type==='seek-result') { handleAutomaticSeek(data); return; }
    if(data.type==='audio-window') { void indexer?.feed(data); return; }
    delay = data.delay; available = data.available;liveTime=data.liveTime;
    if (data.overrun) {
      aligning = false;
      notice('The 3-minute buffer filled. Older audio was replaced; match a play again before continuing.');
    }
    update();
  };
  context.onstatechange = () => {
    if (context?.state === 'suspended') notice('Audio was suspended by the browser. Click Resume audio to continue; check timing afterward.');
  };
}
async function start(kind, file) {
  if (busy) return;
  busy = true; sources.forEach(id => $(id).disabled = true);
  try {
    await disconnect();
    if (kind === 'tab') {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Tab audio sharing needs desktop Chrome or Edge. You can try the demo or open an audio recording here.');
      // Request only a user-selected tab. Never request microphone access.
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { suppressLocalAudioPlayback: true },
        preferCurrentTab: false,
        selfBrowserSurface: 'exclude',
        systemAudio: 'exclude',
      });
      if (!stream.getAudioTracks().length) throw new Error('No audio was shared. Choose the broadcast tab and enable “Share tab audio.”');
    }
    await prepare();
    if (kind === 'tab') {
      source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      source.connect(node);
      for (const track of stream.getTracks()) track.onended = () => {
        void disconnect(); notice('Broadcast sharing ended. Reconnect the tab to start a fresh buffer.');
      };
      $('source-name').textContent = 'Shared broadcast tab';
      notice('Play the Duke broadcast in the shared tab. If you hear it twice, mute that tab using the browser’s tab control, not the broadcast player. Then match a play.');
    } else if (kind === 'duke') {
      selectedBroadcast=schedule && [...schedule.live,...schedule.replays].find(e=>e.id===$('broadcast').value);
      if(!selectedBroadcast || selectedBroadcast.status==='upcoming') throw new Error('Choose a replay or an on-air Duke broadcast.');
      media=new Audio(); media.crossOrigin='anonymous'; media.src=selectedBroadcast.url;
      source=context.createMediaElementSource(media);source.connect(node);
      media.onerror=()=>notice('The Duke audio feed could not be played. Refresh the broadcast list or try the official player.');
      media.onwaiting=()=>{void stopAnalysis();notice('Duke audio is buffering. Timing analysis stopped; restart it when playback returns.');};
      media.onended=()=>{void stopAnalysis();notice('The Duke replay ended. Delayed audio will finish from the buffer.');};
      await media.play();
      $('source-name').textContent=`Duke vs. ${selectedBroadcast.opponent}${selectedBroadcast.status==='replay'?' · replay':''}`;
      notice(selectedBroadcast.status==='replay'?'Playing the official Duke recording. TV clock matching is experimental.':'Playing Duke radio. Point the camera at the TV scoreboard to examine a radio match.');
    } else if (kind === 'file') {
      media = new Audio(); objectURL = URL.createObjectURL(file); media.src = objectURL;
      source = context.createMediaElementSource(media); source.connect(node);
      media.onerror = () => notice('This recording could not be decoded. Try an MP3, AAC, or WAV file.');
      media.onended = () => notice('Recording ended. Any delayed audio will finish playing from the buffer.');
      await media.play();
      $('source-name').textContent = 'Your audio recording';
      notice('Playing your recording. Pause to build delay, or use Match a play with a matching video.');
    } else {
      // A real generated signal travels through the same buffer as broadcast audio.
      source = context.createGain(); source.connect(node);
      const tick = () => {
        if (!context) return;
        const oscillator = context.createOscillator(), envelope = context.createGain();
        const now = context.currentTime;
        oscillator.frequency.value = 660;
        envelope.gain.setValueAtTime(0, now);
        envelope.gain.linearRampToValueAtTime(0.15, now + 0.01);
        envelope.gain.linearRampToValueAtTime(0, now + 0.12);
        oscillator.connect(envelope).connect(source);
        oscillator.start(); oscillator.stop(now + 0.15);
        oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
      };
      tick(); demoTimer = setInterval(tick, 1000);
      $('source-name').textContent = 'Timing demo · repeating tone';
      notice('Demo only — no Duke broadcast. Pause for a few seconds and resume, then try the delay controls.');
    }
    controls.forEach(id => $(id).disabled = false); update();
  } catch (error) {
    await disconnect();
    notice(error.name === 'NotAllowedError' ? 'Sharing was canceled or denied. Click Connect broadcast tab when you’re ready.' : error.message || 'Unable to start audio. Try another source.');
  } finally {
    busy = false; sources.forEach(id => $(id).disabled = false); updateBroadcastButton();
  }
}
$('connect').onclick = () => start('tab');
$('demo').onclick = () => start('demo');
$('file').onchange = event => { const file = event.target.files[0]; if (file) void start('file', file); event.target.value = ''; };
$('pause').onclick = async () => {
  stopAnalysis();
  if (context?.state === 'suspended') { await context.resume(); setPaused(false); }
  else setPaused(!paused);
};
$('live').onclick = () => { stopAnalysis();setDelay(0); setPaused(false); notice('Playing incoming audio with no added delay. If the radio is still late, pause the TV to align it.'); };
$('earlier').onclick = () => { stopAnalysis();setDelay(delay - Number($('step').value)); notice(delay === 0 ? 'No added delay remains. If the call is late, pause the TV to let the radio catch up.' : 'Reduced radio delay.'); };
$('later').onclick = () => { stopAnalysis();const desired = delay + Number($('step').value); setDelay(desired); notice(desired > available ? 'That much history is not available yet. Pause audio briefly to build a buffer.' : 'Added radio delay.'); };
$('align').onclick = () => {
  stopAnalysis();
  if (!aligning) {
    if (paused) { notice('Resume audio before matching a play.'); return; }
    previousDelay = delay; aligning = true; setPaused(true);
    notice('Radio is paused. When you see that same play on TV, tap “I see it on TV.”');
  } else {
    aligning = false; setPaused(false);
    notice('Manual alignment applied. Listen and fine-tune if needed; this is not an automatic sync measurement.');
  }
  update();
};
$('cancel-align').onclick = () => { aligning = false; setDelay(previousDelay); setPaused(false); notice('Match canceled. Restored the previous delay.'); update(); };
$('volume').oninput = () => { if (gain) gain.gain.setTargetAtTime(Number($('volume').value), context.currentTime, 0.02); };
$('stop').onclick = async () => { await disconnect(); notice('Disconnected. The audio buffer has been cleared.'); };
window.addEventListener('pagehide', () => { void disconnect(); });

function updateBroadcastButton() {
  const selected=schedule && [...schedule.live,...schedule.replays].find(e=>e.id===$('broadcast').value);
  $('duke-play').disabled=busy || !selected || selected.status==='upcoming';
  $('duke-play').textContent=selected?.status==='replay'?'Play Duke replay':'Play Duke radio';
}
async function loadSchedule() {
  $('refresh-schedule').disabled=true;
  $('schedule-status').textContent='Loading Duke’s official broadcast list…';
  try {
    const response=await fetch('/api/duke'); const data=await response.json();
    if(!response.ok) throw Error(data.error);
    schedule=data;const select=$('broadcast');select.replaceChildren();
    for(const e of [...data.live,...data.replays]) {
      const option=document.createElement('option');option.value=e.id;
      const date=new Date(e.start).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
      option.textContent=`${e.status==='replay'?'Replay':e.status==='on-air'?'On air':'Upcoming'} · ${e.sport} · ${e.opponent} · ${date}`;
      select.append(option);
    }
    const first=data.live.find(e=>e.status==='on-air')||data.replays[0];
    if(first) select.value=first.id;
    select.disabled=!select.options.length;
    $('schedule-status').textContent=data.live.some(e=>e.status==='on-air')?'Duke lists a broadcast on air now.':'No Duke broadcast is scheduled on air now. Choose a replay.';
    updateBroadcastButton();
  } catch(error) {schedule=null;$('broadcast').replaceChildren();$('broadcast').disabled=true;updateBroadcastButton();$('schedule-status').textContent=error.message||'Could not load Duke’s broadcasts.';}
  finally {$('refresh-schedule').disabled=false;}
}
function stopAnalysis() {
  if(indexer || pendingSync || appliedSync) $('radio-status').textContent='Automatic matching stopped.';
  syncGeneration++;pendingSync=null;appliedSync=null;
  cameraAbort?.abort();cameraAbort=null;
  const stop=stopCamera;stopCamera=null;
  indexer?.stop();indexer=null;
  node?.port.postMessage({type:'analysis',value:false});
  if(stop) void stop().catch(()=>{});
  $('camera').hidden=true;$('stop-sync').hidden=true;$('auto-sync').disabled=!node;
  return syncGeneration;
}
$('duke-play').onclick=()=>start('duke');
$('broadcast').onchange=updateBroadcastButton;
$('refresh-schedule').onclick=loadSchedule;
$('stop-sync').onclick=async()=>{await stopAnalysis();$('radio-status').textContent='Radio and camera analysis stopped.';};
$('auto-sync').onclick=async()=>{
  const generation=stopAnalysis();
  if(!node || aligning) return;
  $('auto-sync').disabled=true;$('stop-sync').hidden=false;$('camera').hidden=false;
  $('radio-status').textContent='Loading local radio recognition…';
  $('camera-status').textContent='Allow the camera, then point it closely at the scoreboard.';
  try {
    cameraAbort=new AbortController();
    const sport=String(selectedBroadcast?.sportId)==='2'?'basketball':String(selectedBroadcast?.sportId)==='3'?'womens-basketball':'football';
    indexer=new RadioIndexer(message=>{if(generation===syncGeneration && !pendingSync && !appliedSync)$('radio-status').textContent=message;},sport);
    await indexer.start();
    if(generation!==syncGeneration || !node) return;
    node.port.postMessage({type:'analysis',value:true});
    const cameraStop=await startScoreboardCamera($('camera'),reading=>{
      if(generation!==syncGeneration) return;
      if(reading.state!=='read') {indexer?.tracker.reset();$('camera-status').textContent=reading.state==='period-missing'?'Clock found. Include the quarter or half in the camera view.':'Hold the camera steady with the game clock and period in view.';return;}
      const minutes=Math.floor(reading.clock/60),seconds=(reading.clock%60).toFixed(0).padStart(2,'0');
      $('camera-status').textContent=`TV: period ${reading.period} · ${minutes}:${seconds} · ${reading.running?'clock moving':'waiting for clock movement'}`;
      const result=indexer?.observe(reading,{oldestAudioTime:Math.max(0,liveTime-available),newestAudioTime:liveTime});
      if(result?.canApply && !pendingSync && !appliedSync) applyAutomaticEstimate(result,generation);
      else if(result?.reason && !pendingSync && !appliedSync) $('radio-status').textContent=result.reason;
    },message=>{if(generation===syncGeneration)$('camera-status').textContent=message;},sport,cameraAbort.signal);
    if(generation!==syncGeneration) await cameraStop();else stopCamera=cameraStop;
  } catch(error) {
    if(generation!==syncGeneration) return;
    stopAnalysis();$('camera-status').textContent=error.name==='NotAllowedError'?'Camera access was not granted.':`Camera reader could not start: ${error.message}`;
  }
};
void loadSchedule();

function applyAutomaticEstimate(estimate,generation) {
  const elapsed=performance.now()/1000-estimate.capturedAt;
  if(elapsed<0 || elapsed>5 || !node || context.state!=='running') return;
  const outputDelay=(Number.isFinite(context.baseLatency)?context.baseLatency:0)+(Number.isFinite(context.outputLatency)?context.outputLatency:0);
  const audioTime=playbackTarget(estimate,{now:performance.now()/1000,outputDelay});
  if(audioTime===null) {$('radio-status').textContent='A newer radio reference is needed to cover playback timing. Keep scanning.';return;}
  pendingSync={requestId:crypto.randomUUID(),generation,estimate};
  node.port.postMessage({type:'seek',requestId:pendingSync.requestId,audioTime,requestedAtContext:context.currentTime});
  $('radio-status').textContent='Applying the estimated radio match…';
}
function handleAutomaticSeek(result) {
  if(!pendingSync || result.requestId!==pendingSync.requestId || pendingSync.generation!==syncGeneration) return;
  const estimate=pendingSync.estimate;pendingSync=null;
  if(result.state==='applied') {
    stopAnalysis();
    appliedSync=estimate;paused=false;delay=result.delay;update();
    $('camera').hidden=true;$('auto-sync').disabled=false;
    $('auto-sync').textContent='Scan TV again';
    $('camera-status').textContent='Camera stopped after the match.';
    $('radio-status').textContent='Automatically aligned · estimated from commentary. Listen and fine-tune if necessary.';
    notice('Automatic estimate applied. Listen to the call and use the timing buttons if it needs a small adjustment.');
  } else {
    indexer?.tracker.reset();
    $('radio-status').textContent=result.state==='audio-behind-tv'?'The radio is behind the TV. Pause the TV briefly and scan again.':result.state==='stale'?'That TV reading is too old to apply. Keep the camera on the scoreboard.':'That moment is no longer available in the audio buffer. Keep scanning.';
  }
}
