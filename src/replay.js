import { mediaURL } from './gateway.js';
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
// Local-clock heuristic for a catalog check time, never an authority: the scheduled refresh runs
// every six hours, so more than two intervals is old. Up to five minutes of future skew counts as
// age zero; a later or unparseable time is unknown. The timestamp itself is never altered.
export const OLD_CATALOG_MS = 12 * 60 * 60 * 1000, CATALOG_SKEW_MS = 5 * 60 * 1000;
export function catalogFreshness(checkedAt, now = Date.now()) {
  const age = now - (typeof checkedAt === 'string' ? Date.parse(checkedAt) : NaN);
  if (!Number.isFinite(age) || age < -CATALOG_SKEW_MS) return 'unknown';
  return age > OLD_CATALOG_MS ? 'old' : 'current';
}

export function validateCatalog(data, options = {}) {
  if (!data || !Number.isFinite(Date.parse(data.checkedAt)) || !data.schools) throw Error('Invalid catalog');
  for (const school of ['duke', 'vt', 'miami']) {
    const source = data.schools[school];
    if (!source || !['ready', 'stale', 'unavailable', 'external'].includes(source.status) || !Array.isArray(source.items) || typeof source.source !== 'string') throw Error('Invalid source');
    if (source.checkedAt !== undefined && !Number.isFinite(Date.parse(source.checkedAt))) throw Error('Invalid source date');
    if (new URL(source.source).protocol !== 'https:' || new URL(source.source).username || new URL(source.source).password) throw Error('Invalid source address');
    for (const item of source.items) {
      if (!item || !['id', 'opponent', 'sport', 'start', 'url', 'kind'].every(key => typeof item[key] === 'string' && item[key].length > 0) || !Number.isFinite(Date.parse(item.start)) || !mediaURL(item.url, { ...options, path: `/media/archive/${school}/${item.id}` })) throw Error('Invalid recording');
    }
  }
  return data;
}
