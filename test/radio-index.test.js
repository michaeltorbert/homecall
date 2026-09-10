import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRadioClockCandidates, matchRadioClockCandidates, associateRadioPeriods } from '../src/radio-index.js';

const options = { streamId: 'duke-game-session-1', startSampleTime: 100 };
function transcript(text) {
  return text.split(/\s+/).map((text, index) => ({ text, timestamp: [index * 0.3, index * 0.3 + 0.25] }));
}
function extract(text) { return extractRadioClockCandidates(transcript(text), options); }

test('spoken game clock carries utterance timestamps and uncertainty, never exact game time', () => {
  const [candidate] = extract('There is twelve thirty remaining in the first quarter');
  assert.equal(candidate.clock, 750);
  assert.equal(candidate.period, 1);
  assert.equal(candidate.periodType, 'quarter');
  assert.equal(candidate.audioTime, 100.6);
  assert.equal(candidate.audioEndTime, 101.15);
  assert.equal(candidate.state, 'candidate');
  assert.equal(candidate.running, null);
  assert.equal(candidate.uncertainty.gameEventOffsetSeconds, null);
  assert.equal(candidate.uncertainty.boundsSeconds, null);
  assert.equal(candidate.provenance.gameTimeValidated, false);
  assert.equal(candidate.provenance.audioTimeMeaning, 'utterance-start');
  assert.deepEqual(candidate.provenance.chunkIndexes, [2, 3]);
  assert.match(candidate.excerpt, /twelve thirty/);
});

test('numeric, spoken-zero, unit and subminute clock formats', () => {
  for (const [text, clock, period] of [
    ['12:30 remaining in the first quarter', 750, 1],
    ['one oh five left in the second half', 65, 2],
    ['one minute and five seconds remaining in the second half', 65, 2],
    ['thirty seconds to play in the second half', 30, 2],
    ['0:04.7 left in the second half', 4.7, 2],
    ['twelve thirty one to go in the first quarter', 751, 1],
    ['two minutes remaining in the first half', 120, 1],
    ['game clock shows 12:30 in the first quarter', 750, 1],
    ['12:30 remaining in the 1st quarter', 750, 1],
  ]) {
    const candidates = extract(text);
    assert.equal(candidates.length, 1, text);
    assert.equal(candidates[0].clock, clock, text);
    assert.equal(candidates[0].period, period, text);
  }
});

test('unspoken period and overtime numbering are kept unknown', () => {
  const [missing] = extract('twelve thirty remaining');
  assert.equal(missing.period, null);
  assert.ok(missing.uncertainty.reasons.includes('absolute-period-unknown'));
  const [overtime] = extract('two minutes remaining in the first overtime');
  assert.equal(overtime.period, null);
  assert.equal(overtime.periodLabel, '1 overtime');
  assert.equal(overtime.periodType, 'overtime');
});

test('observed Duke ASR wording yields uncertain clock candidates, not invented periods or running state', () => {
  const examples = [
    ['clock stops on the incompletion with 157. play till half time', 117, 'stopped', 2],
    ['it was 151 to play in our opening half', 111, 'unknown', 2],
    ['a minute 52 left', 112, 'unknown'],
    ['two time outs and a minute 52 left', 112, 'unknown'],
    ['145 to work with', 105, 'unknown'],
    ['clock rolls, 138 to play in the half', 98, 'running'],
    ['1-12 in the clock, rolling left to be played in the half', 72, 'running'],
    ['a pick up of three. 1 -12 in the clock rolling left to be played in the half', 72, 'running'],
  ];
  for (const [text, clock, reportedClockState, period = null] of examples) {
    const candidates = extractRadioClockCandidates(transcript(text), { ...options, sport: 'football' });
    assert.equal(candidates.length, 1, text);
    assert.equal(candidates[0].clock, clock, text);
    assert.equal(candidates[0].period, period, text);
    assert.equal(candidates[0].reportedClockState, reportedClockState, text);
    assert.equal(candidates[0].running, null, text);
  }
  assert.equal(extractRadioClockCandidates(transcript('1:51 remaining in the first half'), { ...options, sport: 'football' })[0].period, null);
  assert.deepEqual(extract('Duke has 157 rushing yards in the first quarter'), []);
  assert.deepEqual(extract('157 in the first quarter'), []);
  assert.deepEqual(extract('165 remaining in the first quarter'), []);
});

test('common present-tense running-clock wording is recognized without asserting measured movement', () => {
  for (const phrase of ["clock's running", 'clock’s running', 'clock is running', 'clock is still running',
    'clock keeps running', 'clock continues to roll', 'clock continues rolling',
    'clock moving', 'clock ticking', 'clock is ticking', 'running clock', 'clock rolls']) {
    const [candidate] = extract(`${phrase}, 1:38 left in the first quarter`);
    assert.ok(candidate, phrase);
    assert.equal(candidate.reportedClockState, 'running', phrase);
    assert.equal(candidate.running, null, phrase);
    assert.equal(candidate.provenance.gameTimeValidated, false, phrase);
  }
});

test('negated, future, conditional and past clock movement cannot report current running', () => {
  for (const phrase of ['clock will run', 'clock will be running', 'clock is not running',
    "clock isn't running", 'clock is never running', 'clock was running',
    'not a running clock', 'will have a running clock', 'once the clock is running',
    'if the clock is running', 'clock should be running', "clock won't be running"]) {
    const [candidate] = extract(`${phrase}, 1:38 left in the first quarter`);
    assert.ok(candidate, phrase);
    assert.equal(candidate.reportedClockState, 'unknown', phrase);
  }
  for (const phrase of ['clock is running but the clock stops', "clock's stopped", 'clock has stopped',
    'clock stopped and will start again']) {
    const [candidate] = extract(`${phrase}, 1:38 left in the first quarter`);
    assert.ok(candidate, phrase);
    assert.equal(candidate.reportedClockState, 'stopped', phrase);
  }
});

test('self-contained clocks following scores or down-and-distance survive the spoken-number-tail guard', () => {
  for (const text of ['Duke 21, Tulane 14, 1:38 left in the first quarter',
    'Duke 14-10, 1:38 left in the first quarter',
    'second and 7, 1:38 to go in the first quarter',
    'Duke 21, Tulane 14, 1-38 left in the first quarter',
    'second and seven, 1-38 to go in the first quarter']) {
    const candidates = extract(text);
    assert.equal(candidates.length, 1, text);
    assert.equal(candidates[0].clock, 98, text);
  }
  for (const clock of ['1:99', '1:3', '1:20:30', '1-3', '1-20-30', '1-38:45', '1:38-45', '-1-38', '+1-38'])
    assert.deepEqual(extract(`Duke 21, Tulane 14, ${clock} left in the first quarter`), [], clock);
  assert.deepEqual(extract('Duke 14-10 in the first quarter'), []);
  assert.deepEqual(extract('twenty one thirty remaining in the first half'), []);
});

test('sport-specific period clock maxima distinguish women, football and men', () => {
  for (const [sport, valid, invalid] of [
    ['womens-basketball', '10:00 remaining in the first quarter', '10:01 remaining in the first quarter'],
    ['football', '15:00 remaining in the first quarter', '15:01 remaining in the first quarter'],
    ['basketball', '20:00 remaining in the first half', '20:01 remaining in the first half'],
  ]) {
    assert.equal(extractRadioClockCandidates(transcript(valid), { ...options, sport }).length, 1, sport);
    assert.deepEqual(extractRadioClockCandidates(transcript(invalid), { ...options, sport }), [], sport);
  }
  assert.deepEqual(extractRadioClockCandidates(transcript('12:30 remaining'), { ...options, sport: 'womens-basketball' }), []);
  assert.deepEqual(extractRadioClockCandidates(transcript('16:30 remaining'), { ...options, sport: 'football' }), []);
  const [half] = extractRadioClockCandidates(transcript('8:30 remaining in the first half'), { ...options, sport: 'womens-basketball' });
  assert.equal(half.period, null);
  assert.equal(half.radioPeriod, null);
});

function footballCandidate(text, audioTime, streamId = options.streamId) {
  return extractRadioClockCandidates(transcript(text), { streamId, startSampleTime: audioTime, sport: 'football' })[0];
}

test('football period evidence distinguishes an explicit halftime deadline from generic half wording', () => {
  for (const text of ['1:51 to play till halftime', '1:51 to play until half time',
    '1:51 to play in our opening half', '1:51 to play in the first half']) {
    const candidate = footballCandidate(text, 0);
    assert.equal(candidate.period, 2, text);
    assert.equal(candidate.radioPeriod, 2, text);
    assert.equal(candidate.provenance.periodEvidence.kind, 'football-halftime-wording', text);
  }
  for (const text of ['1:51 to play in the half', '1:51 remaining in the first half']) {
    const candidate = footballCandidate(text, 0);
    assert.equal(candidate.period, null, text);
    assert.equal(candidate.provenance.periodEvidence, null, text);
  }
});

test('a continuous radio-only chain associates unknown periods without promoting utterances into exact timing anchors', () => {
  const inputs = [footballCandidate('1:57 to play till halftime', 79.12),
    footballCandidate('1:51 to play in our opening half', 119.78),
    footballCandidate('1:52 left', 158.04), footballCandidate('1:45 to work with', 173.02),
    footballCandidate('clock rolls 1:38 to play in the half', 216.6),
    footballCandidate('1:12 in the clock rolling left in the half', 243.74)];
  const associated = associateRadioPeriods(inputs, { sport: 'football' });
  assert.deepEqual(associated.map(candidate => candidate.period), [2, 2, 2, 2, 2, 2]);
  assert.deepEqual(inputs.map(candidate => candidate.period), [2, 2, null, null, null, null]);
  assert.equal(associated.at(-1).radioPeriod, null);
  assert.equal(associated.at(-1).provenance.gameTimeValidated, false);
  assert.equal(associated.at(-1).periodAssociation.kind, 'radio-context-chain');
  assert.equal(associated.at(-1).periodAssociation.rootId, inputs[1].id);
  assert.equal(associated.at(-1).periodAssociation.policy.uncertaintyAllowanceValidated, false);
  assert.equal(associated.at(-1).periodAssociation.chainIds.length, 5);
});

test('unknown-only candidates stay unknown, including a previously inherited candidate without its root', () => {
  const unknown = footballCandidate('clock rolls 1:38 to play in the half', 30);
  assert.equal(associateRadioPeriods([unknown])[0].period, null);
  const root = footballCandidate('2:00 to play till halftime', 0);
  const inherited = associateRadioPeriods([root, unknown])[1];
  assert.equal(inherited.period, 2);
  assert.equal(associateRadioPeriods([inherited])[0].period, null);
});

test('period propagation stops on gaps, possible period ends, resets, discontinuities and conflicting context', () => {
  const root = footballCandidate('1:40 to play till halftime', 0);
  for (const [next, reason] of [
    [footballCandidate('1:30 remaining', 61), 'radio-candidate-gap'],
    [footballCandidate('1:50 remaining', 10), 'game-clock-reset'],
    [footballCandidate('0:10 remaining', 10), 'game-clock-discontinuity'],
    [{ ...footballCandidate('1:30 remaining', 10), periodLabel: '2 half' }, 'conflicting-radio-period-context'],
    [{ ...footballCandidate('1:30 remaining', 10), periodAmbiguous: true }, 'conflicting-radio-period-evidence'],
  ]) {
    const result = associateRadioPeriods([root, next, footballCandidate('1:25 remaining', next.audioTime + 5)]);
    assert.equal(result[1].period, null, reason);
    assert.equal(result[1].periodAssociation.reason, reason);
    assert.equal(result[2].period, null, reason);
  }
  const nearEnd = associateRadioPeriods([footballCandidate('0:20 to play till halftime', 0), footballCandidate('0:14 remaining', 6)]);
  assert.equal(nearEnd[1].period, null);
  assert.equal(nearEnd[1].periodAssociation.reason, 'period-end-could-have-occurred');
});

test('period evidence is session scoped and new explicit periods start a new chain', () => {
  const first = footballCandidate('2:00 to play till halftime', 0, 'first-stream');
  const second = footballCandidate('1:50 remaining', 10, 'second-stream');
  assert.equal(associateRadioPeriods([first, second])[1].period, null);
  const transition = footballCandidate('14:50 remaining in the third quarter', 300, 'first-stream');
  const next = footballCandidate('14:40 remaining', 310, 'first-stream');
  const result = associateRadioPeriods([first, transition, next]);
  assert.equal(result[2].period, 3);
  assert.equal(result[2].periodAssociation.rootId, transition.id);
  assert.deepEqual(associateRadioPeriods([first, second], { streamId: 'first-stream' }).map(candidate => candidate.streamId), ['first-stream']);
});

test('shot clocks, play clocks, scores, wall times and approximate phrases are not game anchors', () => {
  for (const text of [
    'twelve thirty on the shot clock in the first quarter',
    'the play clock has twenty seconds remaining in the first quarter',
    'Duke leads twelve thirty in the first half',
    'Duke leads twelve to thirty in the first half',
    'tipoff is at 12:30 tomorrow in the first quarter',
    'about twelve thirty remaining in the first quarter',
    'under two minutes remaining in the first half',
    'twelve thirty is the score',
  ]) assert.deepEqual(extract(text), [], text);
});

test('historical and replay clock mentions cannot become current-game candidates', () => {
  for (const text of [
    'earlier there was twelve thirty remaining in the first quarter',
    'on this replay twelve thirty remaining in the first quarter',
    'remember twelve thirty remaining in the first quarter',
    'back at twelve thirty remaining in the first quarter',
    'with twelve thirty remaining in the first quarter yesterday',
    'Smith scored with twelve thirty remaining in the first quarter',
  ]) assert.deepEqual(extract(text), [], text);
});

test('impossible game clocks and contradictory period context are rejected', () => {
  for (const text of [
    '12:99 remaining in the first quarter',
    '16:00 remaining in the first quarter',
    '20:01 remaining in the second half',
    '99:00 remaining in the first half',
    '-1:30 remaining in the first half',
    '12:3 remaining in the first half',
    '1:20:30 remaining in the first half',
    'twenty one thirty remaining in the first half',
    'sixty seconds remaining in the first quarter',
    'first quarter twelve thirty remaining in the second quarter',
  ]) assert.deepEqual(extract(text), [], text);
});

test('missing, invalid and reversed clock-word timestamps do not manufacture audio locations', () => {
  for (const timestamp of [undefined, [0, null], [NaN, 1], [-1, 1], [1, 1], [2, 1], [0]]) {
    const chunks = transcript('twelve thirty remaining in the first quarter');
    chunks[0].timestamp = timestamp;
    assert.deepEqual(extractRadioClockCandidates(chunks, options), []);
  }
  const reversed = transcript('twelve thirty remaining in the first quarter');
  reversed[0].timestamp = [5, 6];
  assert.deepEqual(extractRadioClockCandidates(reversed, options), []);
  const partlyMissing = transcript('one minute and five seconds remaining in the first quarter');
  partlyMissing[0].timestamp = undefined;
  assert.deepEqual(extractRadioClockCandidates(partlyMissing, options), []);
  assert.deepEqual(extractRadioClockCandidates(transcript('12:30 remaining'), {}), []);
  assert.deepEqual(extractRadioClockCandidates(transcript('12:30 remaining'), { ...options, startSampleTime: NaN }), []);
});

test('coarse chunks retain their actual coarse bounds and never invent within-chunk offsets', () => {
  const [candidate] = extractRadioClockCandidates([
    { text: 'twelve thirty remaining in the first quarter', timestamp: [2, 6] },
  ], options);
  assert.equal(candidate.audioTime, 102);
  assert.equal(candidate.audioEndTime, 106);
  assert.equal(candidate.uncertainty.boundsSeconds, null);
});

test('an exact spoken clock match is only a candidate, without a playback target', () => {
  const candidates = extract('twelve thirty remaining in the first quarter');
  const match = matchRadioClockCandidates({ period: 1, clock: 750, running: true }, candidates);
  assert.equal(match.state, 'candidate');
  assert.equal(match.canLock, false);
  assert.equal(match.reason, 'radio-event-timing-reference-required');
  assert.equal(match.candidates[0].clockDifference, 0);
  assert.equal(match.audioTime, undefined);
  assert.equal(match.target, undefined);
});

test('stopped and unknown-running TV clocks cannot identify a unique radio position', () => {
  const candidates = extract('twelve thirty remaining in the first quarter');
  assert.equal(matchRadioClockCandidates({ period: 1, clock: 750, running: false }, candidates).state, 'clock-stopped');
  assert.equal(matchRadioClockCandidates({ period: 1, clock: 750 }, candidates).state, 'clock-motion-unknown');
  assert.equal(matchRadioClockCandidates({ clock: 750, running: true }, candidates).state, 'missing-period');
});

test('repeated same-clock utterances stay ambiguous even when the camera clock is running', () => {
  const first = extract('twelve thirty remaining in the first quarter');
  const second = extractRadioClockCandidates(transcript('twelve thirty remaining in the first quarter'), { ...options, startSampleTime: 160 });
  const match = matchRadioClockCandidates({ period: 1, clock: 750, running: true }, [...first, ...second]);
  assert.equal(match.state, 'ambiguous');
  assert.equal(match.candidates.length, 2);
  assert.equal(match.canLock, false);
  assert.equal(matchRadioClockCandidates({ period: 1, clock: 750, running: true }, [...first, ...first]).state, 'candidate');
});

test('period, stream and clock mismatches do not interpolate across unknown stoppages', () => {
  const candidates = extract('twelve thirty remaining in the first quarter');
  const observation = { period: 1, clock: 750, running: true };
  assert.equal(matchRadioClockCandidates({ ...observation, period: 2 }, candidates).state, 'no-match');
  assert.equal(matchRadioClockCandidates(observation, candidates, { streamId: 'old-session' }).state, 'no-match');
  assert.equal(matchRadioClockCandidates({ ...observation, clock: 740 }, candidates).state, 'no-match');
  assert.equal(matchRadioClockCandidates(observation, extract('twelve thirty remaining')).state, 'no-match');
  assert.equal(matchRadioClockCandidates(observation, candidates, { maxClockDifference: NaN }).state, 'invalid');
});
