// Platform Now Playing metadata for the one audio session that is actually playing (issue #19).
// Metadata only: no action handlers, position state or playback state are written, so browser
// media controls and the in-page controls keep their existing behavior. No network, audio or
// timing dependency: callers claim on a playback start and pass already-validated snapshots.
export const ARTWORK_PATH = 'now-playing/homecall-512.png';
// Original same-origin team artwork (plain school names over the Homecall mark; no team marks).
// Keys are the app's team keys. Anything unrecognized uses the generic Homecall image.
export const TEAM_ARTWORK = Object.freeze({ duke: 'now-playing/duke-512.png', miami: 'now-playing/miami-512.png', vt: 'now-playing/vt-512.png', gt: 'now-playing/gt-512.png' });
// Display labels are the app's own menu and tab names; internal modes and score rules are unchanged.
const MODES = { live: 'Radio stations', game: 'Game broadcasts', sync: 'Game broadcasts', archive: 'Recordings', demo: 'Test tone' };
// Only catalog-bound game audio can carry a scoreboard; radio, recordings and the demo never do.
const BOARD_MODES = new Set(['game', 'sync']);
// Modes whose frozen school may select team artwork. The test tone always uses the generic image.
const TEAM_ART_MODES = new Set(['live', 'game', 'sync', 'archive']);
const MAX_NAME = 32, MAX_TEXT = 80;
// Exact school-name lookup built from the app's own team names: trimmed, case-insensitive, whole
// string only. No prefixes, substrings, punctuation stripping or fuzzy matching, so "Virginia",
// "Miami (OH)" or "Miami (FL)" resolve to nothing. Bare "Miami" means Miami (FL) throughout Homecall.
export function schoolArtworkResolver(teams = {}) {
  const names = new Map();
  for (const [key, team] of Object.entries(teams || {})) if (Object.hasOwn(TEAM_ARTWORK, key) && typeof team?.name === 'string') names.set(team.name.trim().toLowerCase(), key);
  return school => (typeof school === 'string' ? names.get(school.trim().toLowerCase()) ?? null : null);
}
// Team artwork key for one frozen identity: only the selected school counts (never the opponent,
// title or album), and the test tone never gets team artwork.
export function teamArtworkKey(identity, teams) {
  try { return TEAM_ART_MODES.has(identity?.mode) ? schoolArtworkResolver(teams)(identity.school) : null; } catch { return null; }
}
// Same-origin artwork resolved against the deployed base path. With an identity and the app's team
// map, a recognized school selects its team image; everything else gets the generic image.
// Non-network bases (file, blob, data, about) get no artwork at all.
export function nowPlayingArtwork(baseURI, identity = null, teams = null) {
  const key = identity && teams ? teamArtworkKey(identity, teams) : null;
  const file = key ? TEAM_ARTWORK[key] : ARTWORK_PATH;
  try { const url = new URL(file, baseURI); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
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
  return { title: ['Live', `ESPN data received ${time}`, score, periodText(board)].filter(Boolean).join(' · '), artist: `${matchup} · Homecall · ${mode}`, album };
}
// artwork: one image URL string for every identity (compatibility), or identity => URL|null,
// resolved once per claim from the frozen identity. Scores are never part of the artwork.
export function createNowPlaying({ mediaSession = null, MediaMetadata = null, artwork = null, formatTime } = {}) {
  const supported = !!mediaSession && typeof MediaMetadata === 'function';
  let owner = null, published = null;
  const artFor = identity => {
    try { const src = typeof artwork === 'function' ? artwork(identity) : artwork; return typeof src === 'string' && src ? src : null; } catch { return null; }
  };
  function write(text, art = null) {
    if (!supported) return;
    // The dedup key covers the whole payload, so a change of artwork alone is republished.
    const key = text && JSON.stringify([text, art]);
    if (key === published) return;
    try {
      mediaSession.metadata = text ? new MediaMetadata({ ...text, artwork: art ? [{ src: art, sizes: '512x512', type: 'image/png' }] : [] }) : null;
      published = key;
    } catch { published = undefined; /* A rejected payload is retried on the next change. */ }
  }
  const render = token => { if (owner === token) write(nowPlayingText(token.identity, token.snapshot, { formatTime }), token.art); };
  return {
    get supported() { return supported; },
    // Claim on an actual playback start. A superseded owner can never update or clear the new one.
    claim(identity) {
      const frozen = { ...identity };
      const token = { identity: frozen, snapshot: null, art: artFor({ ...frozen }) };
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
