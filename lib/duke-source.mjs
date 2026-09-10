const PLAYER = 'https://duke.leanplayer.com/';
export function safeAudioURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname === 'learfield-gd.leanstream.co' && url.pathname === '/IM3501-MP3') return url.href;
    if (url.hostname === 'ais-aod.leanstream.co' && /^\/gameday\/\d+_35_\d+\.mp3$/.test(url.pathname)) return url.href;
    if (url.hostname === 's3.amazonaws.com' && /^\/archive\.leanplayer\.com\/gameday\/\d+_35_\d+\.mp3$/.test(url.pathname)) return url.href;
  } catch {}
  return null;
}
function decode(text) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#x([\da-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi, (all,hex,decimal,named) => {
    if (hex || decimal) { const cp=Number.parseInt(hex||decimal,hex?16:10); return cp<=0x10ffff ? String.fromCodePoint(cp) : ''; }
    return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[named.toLowerCase()];
  }).trim();
}
function field(xml, tag) { return decode(xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] || ''); }
export function parseEvents(xml, kind, now=Date.now()) {
  if (!xml.includes('<main>') || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Unexpected schedule format');
  const sections = kind === 'live' ? ['current_ev','upcoming_ev'] : ['previous_ev','archived_ev'];
  const events = [];
  for (const section of sections) {
    const contents=xml.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))?.[1] || '';
    for (const match of contents.matchAll(/<event>([\s\S]*?)<\/event>/g)) {
      const raw=match[1], sportId=field(raw,'sport_id');
      if (!['1','2','3'].includes(sportId)) continue;
      const start=Number(field(raw,'start_timestamp'))*1000;
      const end=Date.parse(field(raw,'end').replace(' ','T')+'Z');
      const url=safeAudioURL(field(raw,kind === 'live'?'url':'archive_url') || field(raw,'recorded_url'));
      if (!url || !Number.isFinite(start) || !Number.isFinite(end) || end<=start) continue;
      const isCurrent = section==='current_ev' && start<=now && now<end;
      // A stale provider current flag must not label an expired event live.
      if (kind==='live' && end<=now) continue;
      events.push({id:field(raw,'id'), opponent:field(raw,'opponent'),sportId,
        sport:{1:'Football',2:'Men’s basketball',3:'Women’s basketball'}[sportId],
        start:new Date(start).toISOString(),end:new Date(end).toISOString(),
        status:kind==='archive'?'replay':isCurrent?'on-air':'upcoming',url});
    }
  }
  return [...new Map(events.map(e=>[e.id,e])).values()].sort((a,b)=>kind==='archive'?b.start.localeCompare(a.start):a.start.localeCompare(b.start));
}
async function read(url) {
  const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok) throw Error('Duke schedule is temporarily unavailable');
  const text=await response.text();
  if(text.length>2_000_000) throw Error('Unexpected schedule size');
  return text;
}
export async function fetchDukeSchedule() {
  const html=await read(PLAYER);
  const block=html.match(/var event_xml_urls\s*=\s*\{([\s\S]*?)\};/)?.[1];
  if(!block) throw Error('Duke changed its schedule format');
  const urls=['live','previous'].map(key=> {
    const raw=block.match(new RegExp(`\\b${key}\\s*:\\s*"([^"]+)"`))?.[1];
    const url=new URL(raw);
    if(url.origin!=='https://duke.leanplayer.com' || !/^\/uploads\/xml\/(live|previous)_events_college_35\.xml$/.test(url.pathname)) throw Error('Unexpected schedule address');
    return url.href;
  });
  const [live,archive]=await Promise.all(urls.map(read));
  return {checkedAt:new Date().toISOString(),source:PLAYER,live:parseEvents(live,'live'),replays:parseEvents(archive,'archive').slice(0,30)};
}
