/**
 * Conservative radio indexing from timestamped speech, not game-clock telemetry.
 * All times are seconds in the decoded radio stream. `startSampleTime` is the
 * stream position of the first sample supplied to ASR, not a sample count.
 * A word's timestamp locates the announcer's utterance; it does not establish
 * when the described game moment happened. These exports never confirm a lock.
 */

const smallNumbers = new Map([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
].map((word, value) => [word, value]));
const tens = new Map([['twenty', 20], ['thirty', 30], ['forty', 40], ['fifty', 50]]);
const ordinals = new Map([['first', 1], ['second', 2], ['third', 3], ['fourth', 4], ['1st', 1], ['2nd', 2], ['3rd', 3], ['4th', 4]]);

function tokenize(chunks) {
  const tokens = [];
  for (const [chunkIndex, chunk] of chunks.entries()) {
    if (!chunk || typeof chunk.text !== 'string') continue;
    const validTime = Array.isArray(chunk.timestamp) && chunk.timestamp.length === 2 &&
      chunk.timestamp.every(value => Number.isFinite(value) && value >= 0) &&
      chunk.timestamp[1] > chunk.timestamp[0];
    for (const match of chunk.text.toLowerCase().replace(/[’‘]/g, "'").matchAll(/[+-]?\d+(?:[:-]\d+)+(?:\.\d+)?|[1-4](?:st|nd|rd|th)|\d+(?:\.\d+)?|[a-z]+(?:'[a-z]+)?/g)) {
      tokens.push({ value: match[0], chunkIndex,
        endsSentence: /^[.!?](?:\s|$)/.test(chunk.text.slice(match.index + match[0].length)),
        start: validTime ? chunk.timestamp[0] : null,
        end: validTime ? chunk.timestamp[1] : null });
    }
  }
  return tokens;
}

function numberAt(tokens, position) {
  const value = tokens[position]?.value;
  if (/^\d+(?:\.\d+)?$/.test(value ?? '')) return { value: Number(value), end: position + 1 };
  if (smallNumbers.has(value)) return { value: smallNumbers.get(value), end: position + 1 };
  if (tens.has(value)) {
    const units = smallNumbers.get(tokens[position + 1]?.value);
    if (units > 0 && units < 10) return { value: tens.get(value) + units, end: position + 2 };
    return { value: tens.get(value), end: position + 1 };
  }
  return null;
}

function clockAt(tokens, position) {
  const numeric = /^(\d{1,3})[:-](\d{2}(?:\.\d+)?)$/.exec(tokens[position].value);
  if (numeric) return { minutes: Number(numeric[1]), seconds: Number(numeric[2]), end: position + 1,
    notation: tokens[position].value.includes('-') ? 'dash' : 'colon' };
  const compact = /^(\d{1,2})(\d{2})$/.exec(tokens[position].value);
  if (compact) return { minutes: Number(compact[1]), seconds: Number(compact[2]), end: position + 1, compact: true };
  const first = tokens[position].value === 'a' && tokens[position + 1]?.value === 'minute'
    ? { value: 1, end: position + 1 } : numberAt(tokens, position);
  if (!first) return null;
  let cursor = first.end;
  if (/^seconds?$/.test(tokens[cursor]?.value ?? ''))
    return { minutes: 0, seconds: first.value, end: cursor + 1 };
  if (/^minutes?$/.test(tokens[cursor]?.value ?? '')) {
    cursor++;
    if (tokens[cursor]?.value === 'and') cursor++;
    const second = numberAt(tokens, cursor);
    if (second && /^seconds?$/.test(tokens[second.end]?.value ?? ''))
      return { minutes: first.value, seconds: second.value, end: second.end + 1 };
    if (second && temporalSuffix.test(tokens.slice(second.end, second.end + 5).map(token => token.value).join(' ')))
      return { minutes: first.value, seconds: second.value, end: second.end };
    // Do not reinterpret an unfinished minute/second phrase as an exact minute.
    if (second) return null;
    return { minutes: first.value, seconds: 0, end: first.end + 1 };
  }
  if (tokens[cursor]?.value === 'oh' || tokens[cursor]?.value === 'o') {
    const units = numberAt(tokens, cursor + 1);
    if (units && Number.isInteger(units.value) && units.value >= 0 && units.value < 10)
      return { minutes: first.value, seconds: units.value, end: units.end };
    return null;
  }
  const second = numberAt(tokens, cursor);
  if (!second) return null;
  return { minutes: first.value, seconds: second.value, end: second.end };
}

function nearbyPeriod(tokens, position, end, sport) {
  const found = [];
  for (let i = Math.max(0, position - 9); i < Math.min(tokens.length - 1, end + 12); i++) {
    const ordinal = ordinals.get(tokens[i].value) ?? (/^[1-4]$/.test(tokens[i].value) ? Number(tokens[i].value) : null);
    const unit = tokens[i + 1].value;
    if (ordinal && ['quarter', 'half', 'period', 'overtime'].includes(unit)) {
      if (unit === 'half' && ordinal > 2) continue;
      found.push({ period: unit === 'overtime' || unit === 'half' && ['football','womens-basketball'].includes(sport) ? null : ordinal, periodType: unit,
        periodLabel: `${ordinal} ${unit}`, distance: Math.min(Math.abs(i - position), Math.abs(i - end)) });
    }
    if (tokens[i].value === 'opening' && unit === 'half')
      found.push({ period: null, periodType: 'half', periodLabel: 'opening half', distance: Math.abs(i - position) });
    if (tokens[i].value === 'period' && /^[1-4]$/.test(tokens[i + 1].value)) {
      const period = Number(tokens[i + 1].value);
      found.push({ period, periodType: 'period', periodLabel: `${period} period`, distance: Math.abs(i - position) });
    }
  }
  const after = tokens.slice(end, end + 12).map(token => token.value).join(' ');
  const footballHalftime = sport === 'football' && (
    /^(?:to )?play (?:till|until) half ?time\b/.test(after) ||
    /^to play in (?:(?:our|the) )?(?:opening|first|1st) half\b/.test(after));
  if (footballHalftime) {
    if (found.some(item => item.period !== null && item.period !== 2 || item.periodLabel === '2 half'))
      return { period: null, periodType: null, periodLabel: null, periodAmbiguous: true };
    return { period: 2, periodType: 'quarter', periodLabel: '2 quarter', periodEvidenceKind: 'football-halftime-wording' };
  }
  if (!found.length) return { period: null, periodType: null, periodLabel: null };
  // Competing period mentions make the utterance unsafe to assign a period.
  if (new Set(found.map(item => item.periodLabel)).size > 1)
    return { period: null, periodType: null, periodLabel: null, periodAmbiguous: true };
  const { distance, ...period } = found.sort((a, b) => a.distance - b.distance)[0];
  return period;
}

const historical = /\b(?:earlier|yesterday|replay|replays|replayed|previous|previously|ago|remember|remembered|historical|highlights?|last (?:game|week|night|season|year)|back (?:when|at)|at the time|there (?:was|were)|had (?:been|remaining)|(?:scored|made|hit|missed) (?:at|with))\b/;
const otherClock = /\b(?:shot|play) clock\b/;
const approximate = /\b(?:about|around|approximately|roughly|under|over|nearly|almost|less than|more than)\s*$/;
const wallClock = /\b(?:tonight|tomorrow|noon|midnight|eastern|central|pacific|a m|p m)\b/;
const temporalSuffix = /^(?:(?:is|are|now)\s+)?(?:remaining|left|to (?:play|go|work with)|(?:to )?play (?:till|until) half ?time|(?:on|in) (?:the )?(?:game )?clock)\b/;
const scorePrefix = /\b(?:leads?|trails?|score(?: is)?|tied(?: at)?|up|down|winning|losing)\s*$/;

function reportedState(context) {
  // A positive phrase embedded in a future/conditional/negated description is
  // not an assertion of current movement (e.g. "will have a running clock").
  const nonPresentPrefix = /\b(?:will|would|could|should|might|may|can|cannot|can't|won't|wouldn't|shouldn't|isn't|wasn't|not|never|if|when|once|until)(?:\s+[a-z']+){0,4}\s*$/;
  const affirmative = pattern => [...context.matchAll(pattern)].some(match =>
    !nonPresentPrefix.test(context.slice(0, match.index)));
  // If the surrounding call reports both movement and a stop, the stop wins.
  if (affirmative(/\b(?:clock(?:'s)? (?:(?:is|has|has just|has been|just|now) )?(?:stops?|stopped)|stopped clock)\b/g)) return 'stopped';
  if (affirmative(/\b(?:clock(?:'s)? (?:(?:is|keeps?)(?: on)? (?:still )?(?:running|rolling|moving|ticking)|continues? (?:(?:to )?(?:run|roll|move|tick)|running|rolling|moving|ticking)|(?:still )?(?:runs?|rolls?|moves?|ticks?|running|rolling|moving|ticking))|(?:running|rolling|moving|ticking) clock)\b/g)) return 'running';
  return 'unknown';
}

/**
 * Extract possible clock mentions from ASR `chunks: [{text, timestamp:[s,e]}]`.
 * Missing or nonmonotonic timestamps cannot create a candidate. Missing period
 * stays null; it is never borrowed from the TV or inferred from elapsed audio.
 */
export function extractRadioClockCandidates(chunks, { streamId, startSampleTime = 0, sport } = {}) {
  if (!Array.isArray(chunks) || typeof streamId !== 'string' || !streamId.trim() ||
      !Number.isFinite(startSampleTime) || startSampleTime < 0) return [];
  const tokens = tokenize(chunks);
  const results = [];
  for (let i = 0; i < tokens.length; i++) {
    // A failed long phrase must not be rescued as a different, shorter clock:
    // e.g. an invalid "twenty one thirty" must not yield "one thirty".
    const selfContainedClock = /^\d{1,3}[:-]\d{2}(?:\.\d+)?$/.test(tokens[i].value);
    if (!selfContainedClock && i > 0 && !tokens[i - 1].endsSentence && (numberAt(tokens, i - 1) ||
        /^(?:minutes?|oh|o)$/.test(tokens[i - 1].value) ||
        tokens[i - 1].value === 'and' && /^minutes?$/.test(tokens[i - 2]?.value ?? ''))) continue;
    const clock = clockAt(tokens, i);
    if (!clock) continue;
    const before = tokens.slice(Math.max(0, i - 9), i).map(t => t.value).join(' ');
    const after = tokens.slice(clock.end, clock.end + 12).map(t => t.value).join(' ');
    const context = `${before} ${tokens.slice(i, clock.end).map(t => t.value).join(' ')} ${after}`;
    const period = nearbyPeriod(tokens, i, clock.end, sport);
    const hasTemporalContext = temporalSuffix.test(after) || /\bgame clock(?:\s+(?:is|at|reads|shows|says))*$/.test(before) ||
      (!clock.compact && clock.notation !== 'dash' && period.period !== null && /^(?:in|of) (?:the )?(?:first|second|third|fourth|[1-4](?:st|nd|rd|th)?) (?:quarter|half|period)\b/.test(after));
    const maximumMinutes = sport === 'womens-basketball' ? 10 :
      sport === 'football' || period.periodType === 'quarter' ? 15 : 20;
    const validClock = Number.isInteger(clock.minutes) && clock.minutes >= 0 &&
      clock.minutes <= maximumMinutes && Number.isFinite(clock.seconds) && clock.seconds >= 0 && clock.seconds < 60 &&
      !(clock.minutes === maximumMinutes && clock.seconds > 0);
    const onOtherClock = otherClock.test(before) || otherClock.test(after.split(' ').slice(0, 5).join(' '));
    if (!validClock || !hasTemporalContext || onOtherClock || historical.test(context) ||
        wallClock.test(context) || approximate.test(before) || scorePrefix.test(before) || period.periodAmbiguous) continue;
    const words = tokens.slice(i, clock.end);
    if (words.some(token => token.start === null || token.end === null)) continue;
    // Tokens sharing a chunk have the same coarse bounds. Different chunks must
    // preserve order; malformed ASR output must not invent an audio position.
    if (words.some((token, index) => index > 0 && token.chunkIndex !== words[index - 1].chunkIndex &&
        (token.start < words[index - 1].start || token.end < words[index - 1].end))) continue;
    const audioTime = startSampleTime + words[0].start;
    const audioEndTime = startSampleTime + words.at(-1).end;
    const value = clock.minutes * 60 + clock.seconds;
    const reasons = ['announcer-event-offset-unknown', 'clock-running-state-unknown', 'asr-alignment-error-unmeasured'];
    if (period.period === null) reasons.push('absolute-period-unknown');
    if (clock.compact) reasons.push('compact-asr-time-interpretation');
    const reportedClockState = reportedState(`${before} ${after}`);
    results.push({
      id: `${streamId}:${audioTime}:${value}:${period.periodLabel ?? 'unknown'}`,
      state: 'candidate', streamId, clock: value, ...period, radioPeriod: period.period, audioTime, audioEndTime,
      running: null, reportedClockState, excerpt: context.trim().slice(0, 240),
      uncertainty: { gameEventOffsetSeconds: null, boundsSeconds: null, reasons },
      provenance: { kind: 'asr-clock-mention', streamId, startSampleTime,
        chunkIndexes: [...new Set(words.map(token => token.chunkIndex))],
        audioTimeMeaning: 'utterance-start', timeUnit: 'seconds', gameTimeValidated: false,
        periodEvidence: period.period === null ? null : {
          kind: period.periodEvidenceKind ?? 'explicit-radio-period', period: period.period,
          excerpt: context.trim().slice(0, 240),
        } },
    });
    i = clock.end - 1;
  }
  return results;
}

/**
 * Associate periods using radio evidence only. Explicit radio phase wording
 * starts a chain. Unknown periods can inherit it only while short, plausible
 * audio/clock steps leave a margin before the prior clock could reach zero.
 *
 * The uncertainty allowance is a conservative policy margin, NOT a measured
 * bound on commentator delay. Association is still an inference. Input objects
 * are not mutated, and inherited periods can never become independent roots on
 * a later call: radioPeriod/provenance.periodEvidence retain the original facts.
 */
export function associateRadioPeriods(candidates, {
  streamId, sport = 'football', maxGapSeconds = 60,
  uncertaintyAllowanceSeconds = 15, maxClockIncrease = 2,
} = {}) {
  if (!Array.isArray(candidates) || !Number.isFinite(maxGapSeconds) || maxGapSeconds <= 0 ||
      !Number.isFinite(uncertaintyAllowanceSeconds) || uncertaintyAllowanceSeconds < 0 ||
      !Number.isFinite(maxClockIncrease) || maxClockIncrease < 0) return [];
  const policy = { maxGapSeconds, uncertaintyAllowanceSeconds, maxClockIncrease,
    uncertaintyAllowanceValidated: false };
  const ordered = candidates.filter(candidate => candidate && candidate.provenance?.kind === 'asr-clock-mention' &&
    candidate.state === 'candidate' && typeof candidate.streamId === 'string' && candidate.streamId &&
    (streamId === undefined || candidate.streamId === streamId) &&
    Number.isFinite(candidate.audioTime) && candidate.audioTime >= 0 &&
    Number.isFinite(candidate.clock) && candidate.clock >= 0)
    .map((candidate, index) => ({ candidate, index })).sort((a, b) => a.candidate.audioTime - b.candidate.audioTime || a.index - b.index);
  const chains = new Map();
  const result = [];
  for (const { candidate, index } of ordered) {
    const originalPeriod = Number.isInteger(candidate.radioPeriod) && candidate.radioPeriod > 0 ? candidate.radioPeriod : null;
    const evidence = candidate.provenance.periodEvidence;
    const validEvidence = evidence && ['explicit-radio-period', 'football-halftime-wording'].includes(evidence.kind) &&
      evidence.period === originalPeriod && originalPeriod !== null;
    const { periodAssociation: oldAssociation, ...provenance } = candidate.provenance;
    const current = { ...candidate, period: originalPeriod, provenance,
      periodAssociation: { kind: 'unassociated', reason: 'no-radio-period-evidence' } };
    const previous = chains.get(candidate.streamId);
    const contextConflict = period => ['football','womens-basketball'].includes(sport) && (
      ['opening half', '1 half'].includes(candidate.periodLabel) && period > 2 ||
      candidate.periodLabel === '2 half' && period <= 2);
    if (candidate.periodAmbiguous || (originalPeriod !== null && !validEvidence) ||
        originalPeriod !== null && contextConflict(originalPeriod)) {
      current.period = null;
      current.periodAssociation.reason = 'conflicting-radio-period-evidence';
      chains.delete(candidate.streamId);
    } else if (validEvidence) {
      current.periodAssociation = { kind: 'explicit-radio-evidence', rootId: candidate.id, chainIds: [candidate.id], evidence };
      current.provenance.periodAssociation = current.periodAssociation;
      chains.set(candidate.streamId, { previous: current, period: originalPeriod, rootId: candidate.id, chainIds: [candidate.id], evidence });
    } else if (previous) {
      const elapsed = candidate.audioTime - previous.previous.audioTime;
      const clockDrop = previous.previous.clock - candidate.clock;
      let reason = null;
      if (contextConflict(previous.period)) reason = 'conflicting-radio-period-context';
      else if (elapsed <= 0 || elapsed > maxGapSeconds) reason = 'radio-candidate-gap';
      else if (elapsed + uncertaintyAllowanceSeconds >= previous.previous.clock) reason = 'period-end-could-have-occurred';
      else if (clockDrop < -maxClockIncrease) reason = 'game-clock-reset';
      else if (clockDrop > elapsed + uncertaintyAllowanceSeconds) reason = 'game-clock-discontinuity';
      if (reason) {
        current.periodAssociation.reason = reason;
        chains.delete(candidate.streamId);
      } else {
        current.period = previous.period;
        current.periodAssociation = { kind: 'radio-context-chain', rootId: previous.rootId,
          chainIds: [...previous.chainIds, candidate.id], evidence: previous.evidence, policy,
          gameTimeValidated: false };
        current.provenance.periodAssociation = current.periodAssociation;
        chains.set(candidate.streamId, { ...previous, previous: current, chainIds: current.periodAssociation.chainIds });
      }
    }
    result.push({ current, index });
  }
  return result.sort((a, b) => a.index - b.index).map(item => item.current);
}

/**
 * Compare camera observations with spoken-clock candidates. This is a semantic
 * match only. It does not interpolate through stops, estimate event lag, or emit
 * a playback target. A separate independently validated timing reference is
 * required before the player may seek automatically.
 */
export function matchRadioClockCandidates(observation, candidates, { streamId, maxClockDifference = 1 } = {}) {
  const result = (state, reason, matches = []) => ({ state, reason, canLock: false, candidates: matches });
  if (!observation || !Number.isFinite(observation.clock) || observation.clock < 0 || observation.clock > 1200 ||
      !Array.isArray(candidates) || !Number.isFinite(maxClockDifference) || maxClockDifference < 0)
    return result('invalid', 'invalid-observation-or-candidates');
  if (!Number.isInteger(observation.period) || observation.period < 1)
    return result('missing-period', 'camera-period-required');
  if (observation.running === false) return result('clock-stopped', 'repeated-clock-value-cannot-identify-position');
  if (observation.running !== true) return result('clock-motion-unknown', 'camera-must-observe-clock-movement');
  const unique = new Map();
  for (const candidate of candidates) {
    if (!candidate || candidate.state !== 'candidate' || candidate.provenance?.kind !== 'asr-clock-mention' ||
        typeof candidate.streamId !== 'string' || !candidate.streamId ||
        candidate.period !== observation.period || !Number.isFinite(candidate.clock) ||
        !Number.isFinite(candidate.audioTime) || candidate.audioTime < 0 ||
        (streamId !== undefined && candidate.streamId !== streamId)) continue;
    const clockDifference = candidate.clock - observation.clock;
    if (Math.abs(clockDifference) > maxClockDifference) continue;
    const key = `${candidate.streamId}:${candidate.audioTime}:${candidate.clock}:${candidate.period}`;
    unique.set(key, { ...candidate, clockDifference });
  }
  const matches = [...unique.values()].sort((a, b) => Math.abs(a.clockDifference) - Math.abs(b.clockDifference) || a.audioTime - b.audioTime);
  if (!matches.length) return result('no-match', 'no-explicit-period-and-clock-match');
  if (matches.length > 1) return result('ambiguous', 'multiple-radio-utterances-match', matches);
  return result('candidate', 'radio-event-timing-reference-required', matches);
}
