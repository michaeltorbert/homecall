// All positions are sampled at capture time, never OCR completion time.
export function parseScoreboard(text,sport='football') {
  const clocks=[...text.matchAll(/\b(\d{1,2}):([0-5]\d)(?:\.(\d{1,2}))?\b/g)].map(m=>Number(m[1])*60+Number(m[2])+Number(`0.${m[3]||0}`));
  if(['basketball','womens-basketball'].includes(sport)) {
    for(const m of text.matchAll(/(?<![\d:.]):?([0-5]?\d)\.(\d{1,2})(?![\d:.])/g)) clocks.push(Number(m[1])+Number(`0.${m[2]}`));
  }
  const periodMatch=text.match(/\b(?:Q(?:UARTER)?\s*([1-4])|([1-4])(?:ST|ND|RD|TH)(?!\s*(?:&|AND\b))(?:\s+QUARTER)?)\b/i);
  const halfMatch=text.match(/\b(?:H(?:ALF)?\s*([12])|([12])(?:ST|ND)\s+HALF)\b/i);
  const max=sport==='basketball'?1200:sport==='womens-basketball'?600:900;
  const valid=[...new Set(clocks.filter(c=>c<=max))];
  if(valid.length!==1) return {state:valid.length?'ambiguous':'unreadable'};
  const match=sport==='basketball'?halfMatch||periodMatch:periodMatch;
  if(!match) return {state:'period-missing',clock:valid[0]};
  if(!/\bDUKE?\b/i.test(text)) return {state:'team-missing'};
  return {state:'read',clock:valid[0],period:Number(match[1]||match[2])};
}
export function runningObservation(previous,current) {
  if(!previous || previous.state!=='read' || current.state!=='read' || previous.period!==current.period) return {...current,running:false};
  const elapsed=current.capturedAt-previous.capturedAt, countdown=previous.clock-current.clock;
  return {...current,running:elapsed>=0.4 && elapsed<=4 && countdown>0 && Math.abs(countdown-elapsed)<1.2};
}
export async function startScoreboardCamera(video,onRead,onStatus,sport='football',signal) {
  let stream,worker,timer,closed=false,previous;
  const stop=async()=>{
    closed=true;clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());
    if(stream && video.srcObject===stream) video.srcObject=null;
    const activeWorker=worker;worker=null;await activeWorker?.terminate();
  };
  try {
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});
    if(signal?.aborted) {await stop();throw new DOMException('Camera canceled','AbortError');}
    signal?.addEventListener('abort',()=>{void stop();},{once:true});
    video.srcObject=stream;await video.play();
    if(closed) return stop;
    onStatus('Loading scoreboard reader…');
    const {createWorker}=await import('tesseract.js');
    worker=await createWorker('eng',1,{logger:()=>{}});
    if(closed) {await stop();return stop;}
    await worker.setParameters({tessedit_pageseg_mode:'11'});
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    const scan=async()=>{
      if(closed) return;
      try {
        canvas.width=video.videoWidth;canvas.height=video.videoHeight;
        const capturedAt=performance.now()/1000;
        ctx.drawImage(video,0,0);
        const result=await worker.recognize(canvas);
        if(closed) return;
        const parsed=parseScoreboard(result.data.text,sport);
        // Low-confidence OCR cannot create a usable observation.
        const reading={...parsed,capturedAt,confidence:result.data.confidence};
        if(reading.confidence<65) reading.state='unreadable';
        onRead(runningObservation(previous,reading));previous=reading;
        // Whole-second displays need enough separation to show a decrement.
        timer=setTimeout(scan,Math.max(0,1000-(performance.now()/1000-capturedAt)*1000));
      } catch {if(!closed) onStatus('Scoreboard reading failed. Stop the camera and try again.');await stop();}
    };
    void scan();
    return stop;
  } catch(error) {await stop();throw error;}
}
