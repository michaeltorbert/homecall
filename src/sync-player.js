import Hls from 'hls.js';
// Sync seeks the broadcaster's timestamped HLS window. Live's PCM delay engine is separate.
export class SyncPlayer {
  constructor(audio, onStatus) { this.audio = audio; this.onStatus = onStatus; this.epoch = 0; }
  start(url) {
    this.stop(); const epoch = this.epoch, audio = this.audio;
    const status = text => { if (epoch === this.epoch) this.onStatus(text); };
    audio.onplaying = () => status('Playing. Check alignment with your TV.');
    audio.onwaiting = () => status('Buffering…');
    audio.onpause = () => status('Audio paused.');
    audio.onerror = () => status('Audio could not play. Refresh the feed and try again.');
    audio.onended = () => status('The broadcast ended.');
    this.active = true;
    if (Hls.isSupported()) {
      this.hls = new Hls({backBufferLength:350,maxBufferLength:30});
      this.hls.on(Hls.Events.ERROR, (_,data) => { if(data.fatal) status('The stream stopped. Refresh the feed to reconnect.'); });
      this.hls.loadSource(url); this.hls.attachMedia(audio);
    } else if (audio.canPlayType('application/vnd.apple.mpegurl')) audio.src = url;
    else { this.stop(); this.onStatus('HLS playback is unavailable in this browser.'); return; }
    status('Connecting…'); audio.play().catch(() => status('Press Play in the audio controls to resume.'));
  }
  timing() {
    const utc = this.hls?.playingDate?.getTime(), position = this.audio.currentTime;
    const details = this.hls?.latestLevelDetails;
    const lower = details?.fragments?.[0]?.start ?? -Infinity, upper = details?.edge ?? Infinity;
    const ranges = [];
    for (let i=0;i<this.audio.seekable.length;i++) {
      const start = Math.max(lower,this.audio.seekable.start(i)), end = Math.min(upper,this.audio.seekable.end(i));
      if (end > start) ranges.push([start,end]);
    }
    const spans = (details?.fragments || []).filter(f => Number.isFinite(f.programDateTime) && Number.isFinite(f.start) && Number.isFinite(f.duration) && f.duration > 0)
      .map(f => ({ utc:f.programDateTime, position:f.start, duration:f.duration }));
    return { utc, position, ranges, spans };
  }
  seek(position) {
    if (!Number.isFinite(position) || !this.timing().ranges.some(([a,b]) => position >= a && position <= b)) return false;
    this.audio.currentTime = position; return true;
  }
  live() { const ranges = this.timing().ranges; return ranges.length ? this.seek(Math.max(ranges.at(-1)[0],ranges.at(-1)[1]-3)) : false; }
  stop() {
    ++this.epoch; this.active = false;
    const a = this.audio;
    a.onplaying = a.onwaiting = a.onpause = a.onerror = a.onended = null;
    this.hls?.destroy(); this.hls = null;
    a.pause(); a.removeAttribute('src'); a.load();
  }
}
