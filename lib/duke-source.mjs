// Source addresses and exact URL policy are injected from private configuration.
export function safeAudioURL(value, policy = () => null) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) return null;
    return policy(u.href) ? u.href : null;
  } catch { return null; }
}
function decode(text) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#x([\da-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi, (all,hex,decimal,named) => {
    if (hex || decimal) { const cp=Number.parseInt(hex||decimal,hex?16:10); return cp<=0x10ffff ? String.fromCodePoint(cp) : ''; }
    return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[named.toLowerCase()];
  }).trim();
}
function field(xml, tag) { return decode(xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] || ''); }
export function parseEvents(xml, kind, now=Date.now(), audioPolicy=()=>null) {
  if (!xml.includes('<main>') || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Unexpected schedule format');
  const sections = kind === 'live' ? ['current_ev','upcoming_ev'] : ['previous_ev','archived_ev'];
  if (!sections.some(section => new RegExp(`<${section}(?:\\s[^>]*)?>|<${section}\\s*/>`).test(xml))) throw Error('Schedule sections missing');
  const events = [];
  for (const section of sections) {
    const contents=xml.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))?.[1] || '';
    for (const match of contents.matchAll(/<event>([\s\S]*?)<\/event>/g)) {
      const raw=match[1], sportId=field(raw,'sport_id');
      if (!['1','2','3'].includes(sportId)) continue;
      const start=Number(field(raw,'start_timestamp'))*1000;
      const end=Date.parse(field(raw,'end').replace(' ','T')+'Z');
      const url=safeAudioURL(field(raw,kind === 'live'?'url':'archive_url') || field(raw,'recorded_url'),audioPolicy);
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
export async function fetchDukeSchedule({player,liveFeedPath,archiveFeedPath,audioPolicy,fetcher=fetch,now=Date.now()} = {}) {
  const {readSource}=await import('./archive-source.mjs');
  const origin=new URL(player).origin;
  const html=await readSource(player,fetcher);
  const block=html.match(/var event_xml_urls\s*=\s*\{([\s\S]*?)\};/)?.[1];
  if(!block) throw Error('Schedule format unavailable');
  const urls=['live','previous'].map((key,index)=> {
    const raw=block.match(new RegExp(`\\b${key}\\s*:\\s*"([^"]+)"`))?.[1];
    const url=new URL(raw);
    if(url.origin!==origin || url.pathname!==[liveFeedPath,archiveFeedPath][index] || url.search || url.hash || url.username || url.password) throw Error('Unexpected schedule address');
    return url.href;
  });
  const [live,archive]=await Promise.all(urls.map(url=>readSource(url,fetcher)));
  return {checkedAt:new Date(now).toISOString(),live:parseEvents(live,'live',now,audioPolicy),replays:parseEvents(archive,'archive',now,audioPolicy).slice(0,30)};
}
