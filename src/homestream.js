// Only anonymous catalog routes are used. Media addresses always come from the catalog.
export const HOMESTREAM_API = 'https://oln2xaggec.execute-api.us-east-1.amazonaws.com/v1';
export function mediaURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^[a-z0-9-]+\.cloudfront\.net$/.test(url.hostname) && !url.username && !url.password && !url.port && url.pathname.endsWith('.m3u8') ? url.href : null;
  } catch { return null; }
}
export function normalizeTeams(data) {
  if (data?.success !== true || !Array.isArray(data.teams)) throw Error('catalog-invalid');
  return data.teams.filter(t => typeof t?.team_id === 'string' && typeof t.school_name === 'string')
    .map(t => ({ id: t.team_id, name: t.school_name.trim() }));
}
export function normalizeGames(data, teamId) {
  if (data?.success !== true || !Array.isArray(data.games)) throw Error('catalog-invalid');
  return data.games.filter(g => g?.game_type === 'football' && typeof g.game_id === 'string' && (g.home_team_id === teamId || g.away_team_id === teamId)).map(g => {
    const home = g.home_team_id === teamId;
    const start = g.timezone === 'UTC' && /^\d{4}-\d{2}-\d{2}$/.test(g.date) && /^\d{2}:\d{2}$/.test(g.time) ? Date.parse(`${g.date}T${g.time}:00Z`) : NaN;
    return { id: g.game_id, opponent: String((home ? g.away_team_school_name : g.home_team_school_name) || (home ? g.away_team : g.home_team) || 'Opponent pending'),
      start: Number.isFinite(start) ? start : null, date: typeof g.date === 'string' ? g.date : '',
      url: mediaURL(home ? g.home_cloudfront_url : g.away_cloudfront_url) };
  }).sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
}
export async function readJSON(url, { signal, fetcher = fetch } = {}) {
  const response = await fetcher(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw Error('catalog-unavailable');
  return response.json();
}
export function playlistState(text) {
  if (!text.trimStart().startsWith('#EXTM3U')) throw Error('playlist-invalid');
  const segments = text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  const sequence = Number(text.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/m)?.[1]);
  const duration = Number(text.match(/^#EXT-X-TARGETDURATION:(\d+)/m)?.[1]);
  if (!segments.length || !Number.isFinite(sequence) || !Number.isFinite(duration) || duration < 1 || duration > 30 || !text.includes('#EXTINF:')) throw Error('playlist-invalid');
  return { sequence, segments, duration, ended: text.includes('#EXT-X-ENDLIST') };
}
export function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export async function checkPlaylist(url, { signal, fetcher = fetch, sleep = wait } = {}) {
  if (!mediaURL(url)) return 'unpublished';
  async function sample() {
    const response = await fetcher(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw Error(response.status === 404 ? 'missing' : 'unavailable');
    return playlistState(await response.text());
  }
  try {
    const first = await sample();
    if (first.ended) return 'ended';
    await sleep(Math.max(3000, first.duration * 2000), signal);
    const second = await sample();
    if (second.ended) return 'ended';
    return second.sequence > first.sequence || (second.sequence === first.sequence && second.segments.length > first.segments.length) ? 'ready' : 'stalled';
  } catch (error) {
    if (signal?.aborted) throw error;
    return error.message === 'missing' ? 'missing' : 'unavailable';
  }
}
