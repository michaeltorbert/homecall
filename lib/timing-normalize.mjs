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
const snapshotAge = (ageMs, now, receivedAt) => {
  const residence = Number.isFinite(now) && Number.isFinite(receivedAt) && now >= receivedAt ? now - receivedAt : null;
  return Number.isFinite(ageMs) && ageMs >= 0 && residence !== null ? ageMs + residence : null;
};
// Minimized status envelope: identity/matching fields plus the normalized enum only.
export function normalizeStatusSnapshot(data, now = Date.now(), { teamId, season, ageMs = null, receivedAt = now } = {}) {
  const events = scheduleEvents(data, { teamId, season }).map(({source, competition, event}) => ({...event, status:normalizeGameStatus(source, competition)}));
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
