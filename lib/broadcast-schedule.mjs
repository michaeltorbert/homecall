// Duke network next-broadcast schedule (issue #32; evidence in BROADCAST-SCHEDULE.md). Backend only:
// the browser never receives the player page, the signed feed address, raw XML or an event media URL.
import { strictField, Malformed, idOK, labelOK } from './duke-source.mjs';
import { representationAge } from './backend-json.mjs';

export const SCHEDULE_ROUTE = '/api/broadcast/schedule/duke';
export const SCHEDULE_TIMEOUT_MS = 8000;
export const MAX_SCHEDULE_BYTES = 2 * 1024 * 1024;
const MAX_URL = 2048;
const PRINTABLE = /^[\x21-\x7e]+$/;

// Local product policy, not publisher semantics: the feed has no tentative flag, and the observed
// placeholder rows sat at 4 a.m. Eastern. Any next broadcast (game or show) starting 00:00–06:59 in
// America/New_York is treated as unconfirmed. The time is never estimated or rewritten.
const easternHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit' });
export function uncertainStart(ms) {
  const hour = Number(easternHour.formatToParts(new Date(ms)).find(part => part.type === 'hour')?.value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Malformed();
  return hour < 7;
}

// One recognized element: absent (null), self-closing (empty) or a single plain open/close pair.
// Repeated, attributed or unbalanced forms are malformed rather than read as absent.
function section(xml, tag) {
  const opens = xml.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) || [], closes = xml.match(new RegExp(`</${tag}\\b[^>]*>`, 'g')) || [];
  if (!opens.length && !closes.length) return null;
  if (opens.length !== 1) throw new Malformed();
  if (new RegExp(`^<${tag}\\s*/>$`).test(opens[0])) {
    if (closes.length) throw new Malformed();
    return { content: '', outer: opens[0] };
  }
  if (opens[0] !== `<${tag}>` || closes.length !== 1 || closes[0] !== `</${tag}>`) throw new Malformed();
  const start = xml.indexOf(opens[0]), end = xml.indexOf(closes[0]);
  if (end < start) throw new Malformed();
  return { content: xml.slice(start + opens[0].length, end), outer: xml.slice(start, end + closes[0].length) };
}
// Rows contain only flat leaf elements (text, CDATA or self-closing). Unknown leaves such as the
// media address and naive start/end text are tolerated but never read.
const LEAVES = /^(?:\s*(?:<([A-Za-z_][\w.-]*)\s*\/>|<([A-Za-z_][\w.-]*)>(?:[^<]|<!\[CDATA\[[\s\S]*?\]\]>)*<\/\2>))*\s*$/;
function rows(content, tag) {
  const found = [...content.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map(match => match[1]);
  const opens = (content.match(new RegExp(`<${tag}\\b`, 'g')) || []).length, closes = (content.match(new RegExp(`</${tag}\\b`, 'g')) || []).length;
  if (opens !== found.length || closes !== found.length || content.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g'), '').trim()) throw new Malformed();
  if (!found.every(raw => LEAVES.test(raw))) throw new Malformed();
  return found;
}
const PROLOG = /^﻿?(?:<\?xml(?:\s+[A-Za-z_:][\w.:-]*\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*\s*\?>)?\s*/;
function upcomingEvents(xml) {
  if (typeof xml !== 'string') throw new Malformed();
  const body = xml.replace(PROLOG, '');
  // No DTD, entity declaration, comment or processing instruction beyond the one leading declaration.
  if (/<\?|<!(?!\[CDATA\[)/.test(body)) throw new Malformed();
  const main = /^<main>([\s\S]*)<\/main>\s*$/.exec(body);
  if (!main || (body.match(/<main\b/g) || []).length !== 1 || (body.match(/<\/main\b/g) || []).length !== 1) throw new Malformed();
  const sports = section(main[1], 'sports'), events = section(main[1], 'events');
  if (!sports || !events || main[1].replace(sports.outer, '').replace(events.outer, '').trim()) throw new Malformed();
  const current = section(events.content, 'current_ev'), upcoming = section(events.content, 'upcoming_ev');
  if (!upcoming) throw new Malformed();
  let rest = events.content.replace(upcoming.outer, '');
  // Current rows are structure-checked only: they never supply live status, a start or an end.
  if (current) { rows(current.content, 'event'); rest = rest.replace(current.outer, ''); }
  if (rest.trim()) throw new Malformed();
  const sportMap = new Map();
  for (const raw of rows(sports.content, 'sport')) {
    const id = strictField(raw, 'id'), name = strictField(raw, 'name'), show = strictField(raw, 'is_show');
    if (!/^\d{1,10}$/.test(id) || !labelOK(name) || !['0', '1'].includes(show)) throw new Malformed();
    const prior = sportMap.get(id);
    if (prior && (prior.name !== name || prior.show !== show)) throw new Malformed();
    sportMap.set(id, { name, show });
  }
  const list = new Map();
  for (const raw of rows(upcoming.content, 'event')) {
    // strictField returns '' for a missing tag, so every required field is checked here.
    const id = strictField(raw, 'id'), stamp = strictField(raw, 'start_timestamp'), sportId = strictField(raw, 'sport_id');
    const opponent = strictField(raw, 'opponent'), custom = strictField(raw, 'custom_title');
    const seconds = Number(stamp), start = seconds * 1000, sport = sportMap.get(sportId);
    if (!idOK(id) || !/^\d{1,12}$/.test(stamp) || !(seconds > 0) || !Number.isSafeInteger(start) || !Number.isFinite(new Date(start).getTime())) throw new Malformed();
    if (!/^\d{1,10}$/.test(sportId) || !sport || (opponent && !labelOK(opponent)) || (custom && !labelOK(custom))) throw new Malformed();
    const title = custom || sport.name;
    const event = { id, label: opponent ? `${title}: ${opponent}` : title, kind: sport.show === '1' ? 'show' : 'game', broadcastStart: start };
    const prior = list.get(id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(event)) throw new Malformed();
    list.set(id, event);
  }
  return [...list.values()];
}
// Pure and clock-independent: selection never drops a row because its start has passed. The client
// alone decides "start reached", so only a provider snapshot that moves or withdraws a row advances it.
// Any malformed row anywhere makes the whole result unknown, since its ordering cannot be trusted.
export function parseBroadcastSchedule(xml) {
  try {
    const list = upcomingEvents(xml);
    if (!list.length) return { state: 'none-listed' };
    list.sort((a, b) => a.broadcastStart - b.broadcastStart || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const [next] = list;
    if (list.some(event => event !== next && event.broadcastStart === next.broadcastStart)) return { state: 'unknown', reason: 'ambiguous' };
    // A later unconfirmed row never blocks an earlier confirmed one.
    if (uncertainStart(next.broadcastStart)) return { state: 'unknown', reason: 'uncertain' };
    return { state: 'upcoming', event: next };
  } catch (error) {
    if (error instanceof Malformed) return { state: 'unknown', reason: 'invalid' };
    throw error;
  }
}

// The configured player: a canonical HTTPS address with no credentials, port, query or fragment.
export function trustedPlayer(value) {
  try {
    if (typeof value !== 'string' || value.length > MAX_URL || !PRINTABLE.test(value) || /[?#]/.test(value)) return null;
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && url.href === value ? url : null;
  } catch { return null; }
}
// The single literal live entry of the player's event_xml_urls map, on exactly the player's origin.
// The raw text is checked before URL parsing so normalization cannot turn a bad literal into a good one.
// Its signed query is allowed but must never be logged, cached or returned.
export function resolveLiveURL(html, player, feedPath) {
  if (typeof html !== 'string' || !player) return null;
  const maps = [...html.matchAll(/\bvar\s+event_xml_urls\s*=\s*\{([^{}]*)\}\s*;/g)];
  if (maps.length !== 1 || (html.match(/\bevent_xml_urls\s*=/g) || []).length !== 1) return null;
  const keys = [...maps[0][1].matchAll(/(?:^|[\s,{])(["']?)live\1\s*:/g)], values = [...maps[0][1].matchAll(/(?:^|[\s,{])(["']?)live\1\s*:\s*"([^"]*)"/g)];
  if (keys.length !== 1 || values.length !== 1) return null;
  const raw = values[0][2];
  if (raw.length > MAX_URL || !PRINTABLE.test(raw) || /[\\<>'"`#]/.test(raw) || /&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i.test(raw) || !raw.startsWith(`${player.origin}/`)) return null;
  const path = raw.slice(player.origin.length).split('?')[0];
  if (!/^(?:\/[A-Za-z0-9._~!$&()*+,;=:@%-]+)+$/.test(path) || path.split('/').some(segment => segment === '.' || segment === '..') || /%(?![\da-f]{2})|%(?:2e|2f|5c)/i.test(path)) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.href !== raw || url.protocol !== 'https:' || url.origin !== player.origin || url.username || url.password || url.port || url.hash || url.pathname === player.pathname || url.pathname === feedPath) return null;
  return url.href;
}

// Bounded text read under the caller's combined signal. Errors are replaced by the caller.
async function readText(url, { fetcher, signal, accept, now, maxBytes }) {
  let reader, onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  aborted.catch(() => {});
  try {
    const startedAt = now();
    const response = await Promise.race([fetcher(url, { signal, credentials: 'omit', cache: 'no-store', redirect: 'manual', headers: { Accept: accept } }), aborted]);
    reader = response.body?.getReader();
    if (!response.ok || response.redirected || !reader) throw Error('schedule-unavailable');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '', bytes = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw Error('schedule-too-large');
      text += decoder.decode(value, { stream: true });
    }
    signal.throwIfAborted();
    text += decoder.decode();
    return { text, headers: response.headers, startedAt, receivedAt: now() };
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (reader) void reader.cancel().catch(() => {});
  }
}

// Exactly two metadata requests per miss (player page, then live feed), under one aggregate deadline
// combined with the caller's signal. Thrown errors and diagnostics never carry an address or body.
export async function brokerSchedule(target, { fetcher = fetch, signal, now = Date.now, catalog, diagnostic = () => {}, timeoutMs = SCHEDULE_TIMEOUT_MS, maxBytes = MAX_SCHEDULE_BYTES } = {}) {
  if (target !== SCHEDULE_ROUTE) return null;
  const config = catalog?.archiveConfig, player = trustedPlayer(config?.dukePlayer);
  if (!player) throw Error('schedule-unavailable');
  const deadline = AbortSignal.timeout(timeoutMs), bounded = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let step = 'player';
  try {
    const page = await readText(player.href, { fetcher, signal: bounded, accept: 'text/html', now, maxBytes });
    step = 'resolve';
    const live = resolveLiveURL(page.text, player, config.dukeFeedPath);
    if (!live) throw Error('schedule-unavailable');
    step = 'feed';
    const feed = await readText(live, { fetcher, signal: bounded, accept: 'application/xml, text/xml', now, maxBytes });
    step = 'parse';
    const result = parseBroadcastSchedule(feed.text);
    const data = { schemaVersion: 1, school: 'duke', state: result.state };
    if (result.event) data.event = { id: result.event.id, label: result.event.label, kind: result.event.kind, broadcastStart: result.event.broadcastStart };
    if (result.reason) data.reason = result.reason;
    // Freshness starts at the live feed's own representation age; the player page's age is unused.
    data.checkedAt = feed.receivedAt;
    data.ageMs = representationAge(feed.headers, feed.startedAt, feed.receivedAt);
    return data;
  } catch {
    const failure = deadline.aborted ? 'timeout' : bounded.aborted ? 'aborted' : 'unavailable';
    try { diagnostic({ stage: 'broadcast-schedule', step, failure }); } catch { /* Logging cannot change availability. */ }
    throw failure === 'timeout' ? new DOMException('Schedule deadline', 'TimeoutError') : Error('schedule-unavailable');
  }
}
