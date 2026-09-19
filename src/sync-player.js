import Hls from 'hls.js';
// Sync seeks the broadcaster's timestamped HLS window. Live's PCM delay engine is separate.
export class SyncPlayer {
  constructor(audio, onStatus) { this.audio = audio; this.onStatus = onStatus; this.epoch = 0; }
  start(url, recovery = { attempts: 0 }) {
    this.stop(recovery); const epoch = this.epoch, audio = this.audio;
    const status = text => { if (epoch === this.epoch) this.onStatus(text); };
    let userPaused = false, connected = false;
    const clearStall = () => { if (this.stallTimer) clearTimeout(this.stallTimer); this.stallTimer = null; };
    const retry = () => {
      if (epoch !== this.epoch || this.retryTimer) return;
      if (userPaused || recovery.attempts >= 3) { this.stop(); this.onStatus('The stream stopped. Refresh the feed and press Play to reconnect.'); return; }
      const wait = 1000 * 2 ** recovery.attempts++;
      this.stop(recovery);
      this.onStatus('Connection lost. Reconnecting to the same broadcast; check alignment when it returns.');
      this.retryTimer = setTimeout(() => { this.retryTimer = null; if (this.recovery === recovery) this.start(url, recovery); }, wait);
    };
    audio.onplaying = () => { if (epoch !== this.epoch) return; connected = true; clearStall(); if (this.startupTimer) clearTimeout(this.startupTimer); this.startupTimer = null; userPaused = false; status('Playing. Check alignment with your TV.'); };
    audio.onwaiting = () => {
      if (epoch !== this.epoch) return;
      status('Buffering…');
      if (connected && !userPaused && !this.stallTimer) this.stallTimer = setTimeout(() => { this.stallTimer = null; if (epoch === this.epoch && !userPaused) retry(); }, 20000);
    };
    audio.onstalled = () => { if (epoch === this.epoch && audio.readyState < 3) audio.onwaiting?.(); };
    audio.onpause = () => { if (epoch !== this.epoch) return; userPaused = true; clearStall(); status('Audio paused.'); };
    audio.onerror = retry;
    audio.onended = () => status('The broadcast ended.');
    this.active = true;
    if (Hls.isSupported()) {
      this.hls = new Hls({backBufferLength:350,maxBufferLength:30});
      this.hls.on(Hls.Events.ERROR, (_,data) => { if(data.fatal) retry(); });
      this.hls.loadSource(url); this.hls.attachMedia(audio);
    } else if (audio.canPlayType('application/vnd.apple.mpegurl')) audio.src = url;
    else { this.stop(); this.onStatus('HLS playback is unavailable in this browser.'); return; }
    status('Connecting…'); this.startupTimer = setTimeout(retry, 20000); audio.play().catch(() => { if (epoch !== this.epoch) return; this.stop(); this.onStatus('Refresh the feed and press Play to resume.'); });
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
  stop(recovery = null) {
    if (this.stallTimer) clearTimeout(this.stallTimer); this.stallTimer = null;
    if (this.startupTimer) clearTimeout(this.startupTimer); this.startupTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer); this.retryTimer = null; this.recovery = recovery;
    ++this.epoch; this.active = false;
    const a = this.audio;
    a.onplaying = a.onwaiting = a.onstalled = a.onpause = a.onerror = a.onended = null;
    this.hls?.destroy(); this.hls = null;
    a.pause(); a.removeAttribute('src'); a.load();
  }
}
