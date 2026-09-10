/**
 * Experimental commentary-based automatic alignment.
 * Agreement between running-clock mentions estimates a radio position; it does
 * not measure a commentator's systematic reaction delay. Never call it a
 * verified audiovisual lock. Only interpolate inside supported short segments.
 */
export function estimateRadioPosition(observation, candidates, {
  streamId, sport='football', oldestAudioTime=0, newestAudioTime=Infinity,
  minSpan=8, maxSpan=45, maxDiscrepancy=1.5,
}={}) {
  const fail=(state,reason)=>({state,reason,canApply:false});
  if(!observation || observation.running!==true) return fail('waiting','The TV game clock must be moving.');
  const maxPeriod=sport==='basketball'?2:4;
  const maxClock=sport==='basketball'?1200:sport==='womens-basketball'?600:900;
  if(!Number.isInteger(observation.period) || observation.period<1 || observation.period>maxPeriod || !Number.isFinite(observation.clock) || observation.clock<0 || observation.clock>maxClock || !streamId || !Array.isArray(candidates))
    return fail('invalid','A game period, clock, and current radio session are required.');
  const current=candidates.filter(c=>c.streamId===streamId && Number.isFinite(c.audioTime) && Number.isFinite(c.clock) &&
    c.audioTime>=oldestAudioTime && c.audioTime<=newestAudioTime && c.provenance?.kind==='asr-clock-mention');
  // Overlapping recognition windows must not masquerade as independent evidence.
  const sorted=current.toSorted((a,b)=>a.audioTime-b.audioTime);
  const unique=[];
  for(const c of sorted) {
    if(unique.some(p=>Math.abs(p.audioTime-c.audioTime)<3 && p.clock===c.clock)) continue;
    unique.push(c);
  }
  const estimates=[];
  let tvPassedAnalyzedTime=false;
  let recognitionConflict=false;
  for(let i=0;i<unique.length-1;i++) {
    const a=unique[i],b=unique[i+1];
    if(unique.some(c=>(Math.abs(c.audioTime-a.audioTime)<3 && c.clock!==a.clock) ||
      (Math.abs(c.audioTime-b.audioTime)<3 && c.clock!==b.clock))) {recognitionConflict=true;continue;}
    if(a.reportedClockState!=='running' || b.reportedClockState!=='running') continue;
    // The TV cannot supply missing radio period evidence.
    if(a.period!==observation.period || b.period!==observation.period) continue;
    if(a.periodAmbiguous || b.periodAmbiguous) continue;
    const audioSpan=b.audioTime-a.audioTime, clockSpan=a.clock-b.clock;
    if(audioSpan<minSpan || audioSpan>maxSpan || clockSpan<minSpan) continue;
    if(Math.abs(audioSpan-clockSpan)>maxDiscrepancy) continue;
    if(observation.clock<b.clock) {tvPassedAnalyzedTime=true;continue;}
    if(observation.clock>a.clock) continue;
    // Unit slope preserves real-time playback. The two reference offsets are
    // averaged; their disagreement is visible evidence, not an accuracy bound.
    const offset=(a.audioTime+a.clock+b.audioTime+b.clock)/2;
    const target=offset-observation.clock;
    if(target<oldestAudioTime || target>newestAudioTime) continue;
    estimates.push({audioTime:target,period:observation.period,
      clock:observation.clock,referenceIds:[a.id,b.id],referenceTimes:[a.audioTime,b.audioTime],
      disagreementSeconds:Math.abs(audioSpan-clockSpan),
      timingAccuracy:'unmeasured',source:'running-commentary-clock-sequence'});
  }
  if(!estimates.length && recognitionConflict) return fail('ambiguous','Radio recognition disagreed about a clock reference. Waiting for a clearer sequence.');
  if(!estimates.length) return tvPassedAnalyzedTime
    ? fail('needs-more-lead','The TV has passed the radio time analyzed so far. Briefly pause the TV, then resume it and keep scanning.')
    : fail('waiting','Waiting for two consistent running-clock references covering the TV time.');
  if(estimates.length>1) return fail('ambiguous','More than one radio segment fits this clock. Keep the camera pointed at the scoreboard.');
  return {state:'estimated',canApply:true,...estimates[0]};
}

/** Require repeated camera observations to agree on the same radio segment. */
export class AutomaticSyncTracker {
  constructor(){this.reset();}
  reset(){this.samples=[];}
  observe(observation,candidates,options) {
    const estimate=estimateRadioPosition(observation,candidates,options);
    if(!estimate.canApply || !Number.isFinite(observation.capturedAt)) {this.reset();return {...estimate,canApply:false};}
    const last=this.samples.at(-1);
    if(last && (observation.capturedAt<=last.capturedAt || observation.capturedAt-last.capturedAt>4 ||
      estimate.referenceIds.join('|')!==last.referenceIds.join('|') || estimate.period!==last.period ||
      Math.abs((estimate.audioTime-last.audioTime)-(observation.capturedAt-last.capturedAt))>1.2)) this.reset();
    this.samples.push({...estimate,capturedAt:observation.capturedAt});this.samples=this.samples.slice(-4);
    if(this.samples.length<3 || observation.capturedAt-this.samples[0].capturedAt<1.5)
      return {...estimate,canApply:false,state:'checking',reason:'Checking the match across several camera frames…'};
    const offsets=this.samples.map(sample=>sample.audioTime-sample.capturedAt).toSorted((a,b)=>a-b);
    const middle=Math.floor(offsets.length/2);
    const offset=offsets.length%2?offsets[middle]:(offsets[middle-1]+offsets[middle])/2;
    return {...estimate,audioTime:offset+observation.capturedAt,capturedAt:observation.capturedAt};
  }
}

export function playbackTarget(estimate,{now,outputDelay=0}={}) {
  if(!Number.isFinite(estimate?.audioTime) || !Number.isFinite(estimate?.capturedAt) || !Number.isFinite(now) ||
    !Number.isFinite(outputDelay) || outputDelay<0 || outputDelay>2) return null;
  const elapsed=now-estimate.capturedAt;
  if(elapsed<0 || elapsed>5) return null;
  // A sample rendered now will be audible in outputDelay seconds: select the
  // radio position corresponding to that FUTURE TV moment, not a past one.
  const target=estimate.audioTime+elapsed+outputDelay;
  if(estimate.referenceTimes && (target<estimate.referenceTimes[0] || target>estimate.referenceTimes[1])) return null;
  return target;
}
