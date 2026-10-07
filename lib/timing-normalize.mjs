import { clockSeconds } from '../src/sync-mapping.js';
const validId = value => typeof value === 'string' && /^\d{1,12}$/.test(value);
const validSeason = value => Number.isInteger(value) && value >= 2000 && value < 2100;
// Reject locale-dependent parsing and calendar rollover before mapping media.
function timestamp(value) {
  if (typeof value !== 'string') return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!m) return NaN;
  const [, y, month, day, hour, minute, second, zone, zh, zm] = m;
  if (+y < 1000 || +month < 1 || +month > 12 || +day < 1 || +day > new Date(Date.UTC(+y, +month, 0)).getUTCDate() || +hour > 23 || +minute > 59 || +(second || 0) > 59 || (zone !== 'Z' && (+zh > 23 || +zm > 59))) return NaN;
  return Date.parse(value);
}
function competitionIdentity(competitions, eventId) {
  if (!Array.isArray(competitions) || competitions.length !== 1) return null;
  const competition = competitions[0];
  const teamIds = competition.competitors?.map(c => c.team?.id);
  if (competition.id !== eventId || !Array.isArray(teamIds) || teamIds.length !== 2 || !teamIds.every(validId) || new Set(teamIds).size !== 2) return null;
  if (competition.competitors.some(c => c.id !== undefined && c.id !== c.team.id)) return null;
  return { competition, teamIds };
}
function scheduleEvents(data, { teamId, season } = {}) {
  if (!Array.isArray(data?.events) || !validId(data.team?.id) || !validSeason(data.season?.year) ||
      (teamId !== undefined && data.team.id !== teamId) || (season !== undefined && data.season.year !== season)) throw Error('schedule-identity-unavailable');
  const result = data.events.flatMap(e => {
    const identity = validId(e.id) && competitionIdentity(e.competitions, e.id);
    const teams = identity?.competition.competitors.map(c => c.team?.location);
    if (!identity || !Number.isFinite(timestamp(e.date)) || e.season?.year !== data.season.year || !identity.teamIds.includes(data.team.id) || !teams.every(t => typeof t === 'string' && t.trim())) return [];
    return [{source:e,competition:identity.competition,event:{id:e.id,start:timestamp(e.date),teams,teamIds:identity.teamIds,season:e.season.year}}];
  });
  // Duplicate event records cannot support a unique identity match.
  const counts = new Map();
  for (const {event} of result) counts.set(event.id, (counts.get(event.id) || 0) + 1);
  return result.filter(({event}) => counts.get(event.id) === 1);
}
export function normalizeSchedule(data, options) {
  return scheduleEvents(data, options).map(({event}) => event);
}
// Only coherent provider triples are confident. Final/scheduled shapes were observed in
// the public schedule; IN_PROGRESS/HALFTIME are the supported contract, not a captured
// live sample. Anything else (postponed, canceled, delayed, new names) stays unknown.
const GAME_STATUS = new Map([
  ['STATUS_SCHEDULED|pre|false', 'upcoming'],
  ['STATUS_IN_PROGRESS|in|false', 'live'],
  ['STATUS_HALFTIME|in|false', 'live'],
  ['STATUS_FINAL|post|true', 'completed']
]);
const statusTriple = status => {
  const type = status?.type;
  return type && typeof type.name === 'string' && typeof type.state === 'string' && typeof type.completed === 'boolean' ? `${type.name}|${type.state}|${type.completed}` : null;
};
export function normalizeGameStatus(event, competition) {
  // Status is observed at competition level; an event-level copy must agree exactly.
  const sources = [competition?.status, event?.status].filter(status => status !== undefined && status !== null);
  const triples = sources.map(statusTriple);
  if (!triples.length || triples.includes(null) || new Set(triples).size !== 1) return 'unknown';
  return GAME_STATUS.get(triples[0]) || 'unknown';
}
// Optional scoreboard for coherent live events only (issue #19). Like the live status names,
// in-progress/halftime period, clock and score shapes are a synthetic contract until a live
// provider sample is captured. Any contested or malformed field is omitted, never coerced.
const PHASES = new Map([['STATUS_IN_PROGRESS', 'in-progress'], ['STATUS_HALFTIME', 'halftime']]);
const present = value => value !== undefined && value !== null;
const agreed = values => values.length && values.every(v => v !== null) && new Set(values).size === 1 ? values[0] : null;
function regulationClock(status) {
  const match = typeof status.displayClock === 'string' ? /^(\d{1,2}):([0-5]\d)$/.exec(status.displayClock) : null;
  const seconds = match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  if (!(seconds <= 900) || typeof status.clock !== 'number' || !(status.clock >= 0 && status.clock <= 900) || Math.abs(status.clock - seconds) > 1) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
const score = value => value && typeof value === 'object' && Number.isInteger(value.value) && value.value >= 0 && value.value <= 999 && value.displayValue === String(value.value) ? value.value : null;
export function normalizeScoreboard(event, competition, teamIds) {
  if (normalizeGameStatus(event, competition) !== 'live') return null;
  const sources = [competition?.status, event?.status].filter(present);
  const board = { phase: PHASES.get(sources[0].type.name) };
  const periods = sources.filter(s => present(s.period));
  const period = agreed(periods.map(s => Number.isInteger(s.period) && s.period >= 1 && s.period <= 99 ? s.period : null));
  if (period !== null) board.period = period;
  // Halftime and overtime clocks stay omitted until their provider semantics are verified.
  if (board.phase === 'in-progress' && period !== null && period <= 4) {
    const clock = agreed(sources.filter(s => present(s.clock) || present(s.displayClock)).map(regulationClock));
    if (clock !== null) board.clock = clock;
  }
  const scores = competition.competitors.map(c => score(c.score));
  if (scores.every(v => v !== null)) board.scores = Object.fromEntries(teamIds.map((id, i) => [id, scores[i]]));
  return board;
}
const snapshotAge = (ageMs, now, receivedAt) => {
  const residence = Number.isFinite(now) && Number.isFinite(receivedAt) && now >= receivedAt ? now - receivedAt : null;
  return Number.isFinite(ageMs) && ageMs >= 0 && residence !== null ? ageMs + residence : null;
};
// Minimized status envelope: identity/matching fields plus the normalized enum, and a
// backward-compatible optional scoreboard on live events only.
export function normalizeStatusSnapshot(data, now = Date.now(), { teamId, season, ageMs = null, receivedAt = now } = {}) {
  const events = scheduleEvents(data, { teamId, season }).map(({source, competition, event}) => {
    const status = normalizeGameStatus(source, competition);
    const scoreboard = status === 'live' ? normalizeScoreboard(source, competition, event.teamIds) : null;
    return scoreboard ? {...event, status, scoreboard} : {...event, status};
  });
  return { schemaVersion:1,teamId:data.team.id,season:data.season.year,checkedAt:now,ageMs:snapshotAge(ageMs, now, receivedAt),events };
}
export function normalizePlays(data, now = Date.now(), { eventId, ageMs = null, receivedAt = now } = {}) {
  const header = data?.header;
  const identity = header && validId(header.id) && competitionIdentity(header.competitions, header.id);
  if (!identity || (eventId !== undefined && header.id !== eventId) ||
      header.uid !== `s:20~l:23~e:${header.id}` || header.league?.id !== '23' || header.league.slug !== 'college-football' ||
      !validSeason(header.season?.year) || !data.drives) throw Error('plays-identity-unavailable');
  const previous = data.drives.previous ?? [];
  if (!Array.isArray(previous)) throw Error('plays-unavailable');
  const drives = [...previous, ...(data.drives.current ? [data.drives.current] : [])];
  const plays = new Map();
  for (const drive of drives) {
    if (drive.plays !== undefined && !Array.isArray(drive.plays)) throw Error('plays-unavailable');
    for (const p of drive.plays || []) {
      if (!p || typeof p.id !== 'string') continue;
      // A withdrawn/invalid correction must also remove its earlier anchor.
      plays.delete(p.id);
      const utc = timestamp(p.wallclock), quarter = p.period?.number, clock = p.clock?.displayValue;
      if (typeof p.id === 'string' && Number.isFinite(utc) && Number.isInteger(quarter) && quarter > 0 && Number.isFinite(clockSeconds(clock))) {
        plays.set(p.id,{id:p.id,utc,quarter,clock,text:typeof p.text === 'string' ? p.text : 'Play'});
      }
    }
  }
  // Keep source array order. Numeric IDs are not a documented chronology contract.
  const ordered = [...plays.values()];
  return { schemaVersion:2,eventId:header.id,teamIds:identity.teamIds,season:header.season.year,checkedAt:now,ageMs:snapshotAge(ageMs, now, receivedAt),
    plays:ordered,conflict:ordered.some((p,i) => i > 0 && p.utc < ordered[i-1].utc) };
}
