// Native recorded audio supports seeking without the live player's rolling buffer.
export function seekReplay(audio, delta) {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0 || !Number.isFinite(delta)) return false;
  audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + delta));
  return true;
}
export function filterReplays(items, sport, year) {
  return items.filter(item => (!sport || item.sport === sport) && (!year || item.start.slice(0, 4) === year));
}
export function stopReplay(audio) {
  audio.pause(); audio.removeAttribute('src'); audio.load();
}
