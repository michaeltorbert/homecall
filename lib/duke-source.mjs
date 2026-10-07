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
// Strict archive refresh diagnostics are numeric counts only; never raw rows, URLs or titles.
export const rowCounts = () => ({rows:0,accepted:0,unsupported:0,future:0,unrecorded:0,duplicateIdentical:0,sourceExcluded:0,malformed:0,policyRejected:0,duplicateConflict:0,structural:0,excludedOnly:0});
export const rejectedRows = counts => counts.malformed + counts.policyRejected + counts.duplicateConflict + counts.structural + counts.excludedOnly;
export const idOK = value => /^[A-Za-z0-9_-]{1,100}$/.test(value);
export const labelOK = value => typeof value === 'string' && value.length > 0 && value.length <= 500 && value.trim() === value;
class Malformed extends Error {}
// Bounded recognition of the known feed contract, not a general XML parser: a recognized tag
// that is repeated, attributed or unclosed is malformed rather than silently read as absent.
function strictField(xml, tag) {
  const opens = xml.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) || [];
  if (!opens.length) return '';
  if (opens.length > 1) throw new Malformed();
  if (new RegExp(`^<${tag}\\s*/>$`).test(opens[0])) return '';
  const value = opens[0] === `<${tag}>` && xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!value) throw new Malformed();
  return decode(value[1]);
}
function strictArchive(xml, sections, now, audioPolicy, counts, review) {
  const events = new Map();
  for (const section of sections) {
    const opens = xml.match(new RegExp(`<${section}\\b[^>]*>`, 'g')) || [];
    if (!opens.length || (opens.length === 1 && new RegExp(`^<${section}\\s*/>$`).test(opens[0]))) continue;
    const contents = opens.length === 1 && opens[0] === `<${section}>` && xml.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))?.[1];
    if (typeof contents !== 'string') { counts.structural++; continue; }
    const rows = [...contents.matchAll(/<event>([\s\S]*?)<\/event>/g)];
    if ((contents.match(/<event\b/g) || []).length !== rows.length || (contents.match(/<\/event>/g) || []).length !== rows.length) { counts.structural++; continue; }
    // Only whitespace may remain once complete <event> blocks are removed; anything else (such as
    // a renamed event element) is structural rather than a silently smaller or empty list.
    if (contents.replace(/<event>[\s\S]*?<\/event>/g, '').trim()) { counts.structural++; continue; }
    for (const [, raw] of rows) {
      counts.rows++;
      try {
        const archive = strictField(raw,'archive_url'), recorded = strictField(raw,'recorded_url');
        if (!archive && !recorded) { counts.unrecorded++; continue; }
        // Only an explicit, well-formed sport ID outside the supported set is unsupported.
        const sportId = strictField(raw,'sport_id'), wellFormed = /^\d{1,10}$/.test(sportId);
        if (wellFormed && !['1','2','3'].includes(sportId)) { counts.unsupported++; continue; }
        const startText = strictField(raw,'start_timestamp'), start = Number(startText) * 1000;
        if (!/^\d{1,12}$/.test(startText) || !(start > 0)) throw new Malformed();
        if (start >= now) { counts.future++; continue; }
        if (!wellFormed) throw new Malformed();
        const end = Date.parse(strictField(raw,'end').replace(' ','T')+'Z');
        const id = strictField(raw,'id'), opponent = strictField(raw,'opponent');
        if (!Number.isFinite(end) || end <= start || !idOK(id) || !labelOK(opponent)) throw new Malformed();
        // Every advertised address must pass; a rejected one never falls back to the other field.
        const addresses = [archive, recorded].filter(Boolean), urls = addresses.map(value => safeAudioURL(value, audioPolicy));
        // fetchArchive alone decides whether an otherwise valid row whose every address is rejected
        // matches a reviewed source exclusion; mixed valid/rejected addresses always fail.
        if (review && urls.every(url => !url)) { review.push({id, row: raw, addresses}); continue; }
        if (urls.some(url => !url)) { counts.policyRejected++; continue; }
        const sport = {1:'Football',2:'Men’s basketball',3:'Women’s basketball'}[sportId];
        const event = {id,opponent,sportId,sport,start:new Date(start).toISOString(),end:new Date(end).toISOString(),status:'replay',url:urls[0]};
        const prior = events.get(id);
        if (!prior) { events.set(id, event); counts.accepted++; }
        else if (JSON.stringify(prior) === JSON.stringify(event)) counts.duplicateIdentical++;
        else counts.duplicateConflict++;
      } catch (error) { if (!(error instanceof Malformed)) throw error; counts.malformed++; }
    }
  }
  if (rejectedRows(counts)) throw Error('Archive rows rejected');
  return [...events.values()].sort((a,b)=>b.start.localeCompare(a.start));
}
// `strict` is for the scheduled archive refresh only: an eligible past recording that is malformed,
// policy-rejected or conflicting fails the whole result instead of disappearing from it.
// `review` is an internal collector for fetchArchive; see excludeReviewedRows in archive-source.mjs.
export function parseEvents(xml, kind, now=Date.now(), audioPolicy=()=>null, {strict=false, counts=rowCounts(), review} = {}) {
  if (!xml.includes('<main>') || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Unexpected schedule format');
  const sections = kind === 'live' ? ['current_ev','upcoming_ev'] : ['previous_ev','archived_ev'];
  if (!sections.some(section => new RegExp(`<${section}(?:\\s[^>]*)?>|<${section}\\s*/>`).test(xml))) throw Error('Schedule sections missing');
  if (strict) {
    if (kind !== 'archive') throw Error('Strict parsing supports archives only');
    return strictArchive(xml, sections, now, audioPolicy, counts, review);
  }
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
