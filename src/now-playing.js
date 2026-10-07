// Platform Now Playing metadata for the one audio session that is actually playing (issue #19).
// Metadata only: no action handlers, position state or playback state are written, so browser
// media controls and the in-page controls keep their existing behavior. No network, audio or
// timing dependency: callers claim on a playback start and pass already-validated snapshots.
export const ARTWORK_PATH = 'now-playing/homecall-512.png';
const MODES = { live: 'Live radio', game: 'Live game', sync: 'Sync game', archive: 'Archive recording', demo: 'Timing demo' };
// Only catalog-bound game audio can carry a scoreboard; radio, recordings and the demo never do.
const BOARD_MODES = new Set(['game', 'sync']);
const MAX_NAME = 32, MAX_TEXT = 80;
// One original Homecall PNG for every mode and school, resolved against the deployed base path.
export function nowPlayingArtwork(baseURI) {
  try { const url = new URL(ARTWORK_PATH, baseURI); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
const clean = (value, max) => {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};
// Receipt time of the accepted snapshot, with its date: a lock screen can outlive the game.
export const formatReceipt = ms => new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export function periodText(board) {
  if (board.phase === 'halftime') return 'Halftime';
  if (!Number.isInteger(board.period)) return 'In progress';
  return board.period <= 4 ? `Q${board.period}${board.clock ? ` ${board.clock}` : ''}` : `OT${board.period - 4}`;
}
// Source and receipt time share the title field with the score and precede it. Native surfaces may
// still truncate, lay out or cache the field independently; there is no native rendering guarantee.
export function nowPlayingText(identity, snapshot = null, { formatTime = formatReceipt } = {}) {
  const school = clean(identity.school, MAX_NAME), opponent = clean(identity.opponent, MAX_NAME);
  const matchup = school && opponent ? `${school} vs ${opponent}` : '';
  const mode = MODES[identity.mode] || 'Audio';
  const album = clean(identity.album, MAX_TEXT) || school || 'Homecall';
  const plain = { title: clean(identity.title, MAX_TEXT) || matchup || school || 'Homecall', artist: `Homecall · ${mode}`, album };
  const board = snapshot?.board;
  if (!board || !matchup || !BOARD_MODES.has(identity.mode)) return plain;
  let time = '';
  try { time = clean(formatTime(snapshot.receivedAt), 40); } catch { /* Without a receipt time no score is shown. */ }
  if (!time || !Number.isFinite(snapshot.receivedAt)) return plain;
  const ids = Object.keys(board.scores || {}), other = ids.find(id => id !== snapshot.providerId);
  // The selected school is shown first by provider ID, never by provider array or home/away order.
  const score = ids.length === 2 && ids.includes(snapshot.providerId) && other ? `${school} ${board.scores[snapshot.providerId]}, ${opponent} ${board.scores[other]}` : '';
  return { title: ['Live', `ESPN data received ${time}`, score, periodText(board)].filter(Boolean).join(' · '), artist: `${matchup} · Homecall ${mode}`, album };
}
export function createNowPlaying({ mediaSession = null, MediaMetadata = null, artwork = null, formatTime } = {}) {
  const supported = !!mediaSession && typeof MediaMetadata === 'function';
  let owner = null, published = null;
  function write(text) {
    if (!supported) return;
    const key = text && JSON.stringify(text);
    if (key === published) return;
    try {
      mediaSession.metadata = text ? new MediaMetadata({ ...text, artwork: artwork ? [{ src: artwork, sizes: '512x512', type: 'image/png' }] : [] }) : null;
      published = key;
    } catch { published = undefined; /* A rejected payload is retried on the next change. */ }
  }
  const render = token => { if (owner === token) write(nowPlayingText(token.identity, token.snapshot, { formatTime })); };
  return {
    get supported() { return supported; },
    // Claim on an actual playback start. A superseded owner can never update or clear the new one.
    claim(identity) {
      const token = { identity: { ...identity }, snapshot: null };
      owner = token; render(token);
      return {
        get current() { return owner === token; },
        // null strips volatile data and keeps the static identity and artwork.
        update(snapshot) {
          if (owner !== token) return false;
          token.snapshot = snapshot && BOARD_MODES.has(token.identity.mode) ? snapshot : null;
          render(token); return true;
        },
        release() { if (owner !== token) return false; owner = null; write(null); return true; }
      };
    }
  };
}
