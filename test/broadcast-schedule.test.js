// Duke next-broadcast schedule (issue #32). SYNTHETIC fixtures shaped like the observed feed contract;
// no captured provider address, signed query or media URL is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBroadcastSchedule, resolveLiveURL, trustedPlayer, brokerSchedule, uncertainStart, SCHEDULE_ROUTE } from '../lib/broadcast-schedule.mjs';
import { parseEvents } from '../lib/duke-source.mjs';

const SPORTS = '<sports><sport><id>1</id><name>Football</name><is_show>0</is_show></sport><sport><id>898</id><name>Football Radio Show</name><is_show>1</is_show></sport><sport><id>2</id><name>Men&#x2019;s Basketball</name><is_show>0</is_show></sport></sports>';
// 2026-10-17 18:00Z = 2 p.m. EDT; 2026-10-13 23:00Z = 7 p.m. EDT; 08:00Z on Oct 31 and 09:00Z on Nov 7 are 4 a.m. Eastern.
const GAME = 1792260000, SHOW = 1791932400, EDT_4AM = 1793433600, EST_4AM = 1794042000;
const ev = ({ id = 'e1', start = GAME, sport = '1', opponent = 'Visitor', custom, extra = '', text = '2026-01-01 00:00:00' } = {}) =>
  `<event>${id === null ? '' : `<id>${id}</id>`}${start === null ? '' : `<start_timestamp>${start}</start_timestamp>`}<start>${text}</start><end>${text}</end>${sport === null ? '' : `<sport_id>${sport}</sport_id>`}` +
  `${opponent === null ? '<opponent/>' : `<opponent>${opponent}</opponent>`}${custom === undefined ? '' : `<custom_title>${custom}</custom_title>`}<url>https://media.example/live?token=leaf</url>${extra}</event>`;
const feed = (upcoming, { current = '', prolog = '', sports = SPORTS } = {}) => `${prolog}<main>${sports}<events><current_ev>${current}</current_ev><upcoming_ev>${upcoming}</upcoming_ev></events></main>`;
const parse = xml => parseBroadcastSchedule(xml);

test('the earliest upcoming row is next, shows count, labels come from the sports table and media/naive time leaves are never read', () => {
  const result = parse(feed(ev({ id: 'g1' }) + ev({ id: 's1', start: SHOW, sport: '898', opponent: null }), { current: ev({ id: 'c1', start: 1 }) }));
  assert.deepEqual(result, { state: 'upcoming', event: { id: 's1', label: 'Football Radio Show', kind: 'show', broadcastStart: SHOW * 1000 } });
  assert.deepEqual(parse(feed(ev({ id: 'g1', opponent: 'UNC ' }))).event, { id: 'g1', label: 'Football: UNC', kind: 'game', broadcastStart: GAME * 1000 });
  assert.equal(parse(feed(ev({ sport: '2', opponent: 'North &amp; South' }))).event.label, 'Men’s Basketball: North & South');
  assert.equal(parse(feed(ev({ custom: 'Season Preview' }))).event.label, 'Season Preview: Visitor');
  // Different naive start/end text and media leaves cannot change the result.
  assert.deepEqual(parse(feed(ev({ text: '1999-12-31 23:59:59' }))), parse(feed(ev())));
  assert.ok(!JSON.stringify(parse(feed(ev()))).includes('media.example'));
  assert.deepEqual(parse(feed(ev(), { prolog: '<?xml version="1.0"?>\n' })), parse(feed(ev())));
  assert.deepEqual(parse(feed(ev(), { prolog: '﻿<?xml version="1.0" encoding="UTF-8"?>' })), parse(feed(ev())));
});
test('selection is clock-independent: a started row stays next until the provider moves or withdraws it', () => {
  const started = parse(feed(ev({ id: 'old', start: 1 }) + ev({ id: 'later' })));
  assert.equal(started.event.id, 'old');
  assert.equal(parse(feed(ev({ id: 'later' }))).event.id, 'later');
});
test('a structurally valid empty upcoming section is "none listed"; a missing one is unknown', () => {
  for (const empty of ['<upcoming_ev></upcoming_ev>', '<upcoming_ev/>', '<upcoming_ev />', '<upcoming_ev>\n </upcoming_ev>'])
    assert.deepEqual(parse(`<main>${SPORTS}<events><current_ev/>${empty}</events></main>`), { state: 'none-listed' }, empty);
  assert.deepEqual(parse(`<main>${SPORTS}<events>${'<upcoming_ev/>'}</events></main>`), { state: 'none-listed' });
  assert.deepEqual(parse(`<main>${SPORTS}<events><current_ev/></events></main>`), { state: 'unknown', reason: 'invalid' });
});
test('any malformed row, mapping or structure anywhere makes the whole result unknown', () => {
  const invalid = { state: 'unknown', reason: 'invalid' };
  const cases = {
    'missing id': feed(ev({ id: null })), 'bad id': feed(ev({ id: 'has space' })), 'missing start': feed(ev({ start: null })),
    'text start': feed(ev({ start: 'soon' })), 'zero start': feed(ev({ start: 0 })), 'long start': feed(ev({ start: '1234567890123' })),
    'missing sport': feed(ev({ sport: null })), 'unknown sport': feed(ev({ sport: '999' })), 'text sport': feed(ev({ sport: 'FB' })),
    'long opponent': feed(ev({ opponent: 'x'.repeat(501) })), 'repeated leaf': feed(ev({ extra: '<id>e2</id>' })), 'attributed leaf': feed(ev({ extra: '<note kind="x">y</note>' })),
    'nested leaf': feed(ev({ extra: '<note><b>y</b></note>' })), 'later malformed row': feed(ev({ id: 'first', start: SHOW, sport: '898' }) + ev({ id: 'second', start: null })),
    'conflicting duplicate': feed(ev() + ev({ opponent: 'Other' })), 'sport without name': feed(ev(), { sports: '<sports><sport><id>1</id><is_show>0</is_show></sport></sports>' }),
    'bad is_show': feed(ev(), { sports: '<sports><sport><id>1</id><name>Football</name><is_show>2</is_show></sport></sports>' }),
    'conflicting sport': feed(ev(), { sports: SPORTS.replace('</sports>', '<sport><id>1</id><name>Soccer</name><is_show>0</is_show></sport></sports>') }),
    'missing sports': `<main><events><upcoming_ev>${ev()}</upcoming_ev></events></main>`,
    'repeated upcoming': `<main>${SPORTS}<events><upcoming_ev>${ev()}</upcoming_ev><upcoming_ev/></events></main>`,
    'attributed upcoming': `<main>${SPORTS}<events><upcoming_ev kind="x">${ev()}</upcoming_ev></events></main>`,
    'unknown section': `<main>${SPORTS}<events><upcoming_ev>${ev()}</upcoming_ev><previous_ev/></events></main>`,
    'residue text': feed(ev() + 'stray'), 'renamed row': feed('<item><id>e2</id></item>'), 'nested event': feed(ev().replace('<event>', '<event><event>')),
    'unclosed event': feed(ev().replace('</event>', '')), 'unclosed main': feed(ev()).replace('</main>', ''), 'html page': '<html><body>error</body></html>',
    doctype: feed(ev(), { prolog: '<!DOCTYPE main>' }), entity: feed(ev(), { prolog: '<!DOCTYPE main [<!ENTITY x "y">]>' }), comment: feed(ev() + '<!-- note -->'),
    'late instruction': feed(ev()).replace('<events>', '<?php x ?><events>'), 'second declaration': feed(ev(), { prolog: '<?xml version="1.0"?><?xml version="1.0"?>' }),
    'trailing element': feed(ev()) + '<main/>', 'malformed current row': feed(ev(), { current: '<event><id>c</id>' })
  };
  for (const [name, xml] of Object.entries(cases)) assert.deepEqual(parse(xml), invalid, name);
  assert.deepEqual(parse(feed(ev() + ev())), parse(feed(ev())), 'identical duplicates coalesce');
  assert.deepEqual(parse(feed(ev({ custom: ' ' }))), parse(feed(ev())), 'a blank custom title falls back to the sport');
});
test('different events at the same earliest time are ambiguous; a later simultaneous pair does not affect the next event', () => {
  assert.deepEqual(parse(feed(ev({ id: 'a' }) + ev({ id: 'b', sport: '898', opponent: null }))), { state: 'unknown', reason: 'ambiguous' });
  assert.equal(parse(feed(ev({ id: 'a', start: SHOW, sport: '898', opponent: null }) + ev({ id: 'b' }) + ev({ id: 'c', sport: '2' }))).event.id, 'a');
});
test('the local overnight policy (00:00–06:59 America/New_York) applies to games and shows in daylight and standard time', () => {
  for (const [seconds, uncertain] of [[EDT_4AM, true], [EST_4AM, true], [1793444340, true], [1793444400, false], [1794052740, true], [1794052800, false], [1793768400, true], [1793764740, false], [GAME, false], [SHOW, false]])
    assert.equal(uncertainStart(seconds * 1000), uncertain, String(seconds));
  for (const sport of ['1', '898']) assert.deepEqual(parse(feed(ev({ start: EDT_4AM, sport }))), { state: 'unknown', reason: 'uncertain' }, sport);
  assert.deepEqual(parse(feed(ev({ id: 'tba', start: EDT_4AM }) + ev({ id: 'later', start: EDT_4AM + 86400 * 3 + 50400 }))), { state: 'unknown', reason: 'uncertain' }, 'an earlier unconfirmed row is never skipped');
  assert.equal(parse(feed(ev({ id: 'show', start: SHOW, sport: '898', opponent: null }) + ev({ id: 'tba', start: EDT_4AM }))).event.id, 'show', 'a later unconfirmed row does not block');
});
test('the existing lossy live and archive parsers are unchanged by the exported helpers', () => {
  const xml = `<main><events><current_ev></current_ev><upcoming_ev>${ev({ id: 'g', start: 200, text: '1970-01-01 00:05:00' })}</upcoming_ev></events></main>`;
  assert.equal(parseEvents(xml, 'live', 100000, () => true)[0].status, 'upcoming');
});

const PLAYER = 'https://player.example/';
const player = trustedPlayer(PLAYER);
const page = live => `<html><script>var event_xml_urls = {live: "${live}", previous: "https://player.example/previous.xml"};</script></html>`;
const SIGNED = 'https://player.example/xml/live.xml?expires=1700000000&signature=SECRET-SIGNATURE';
test('only the configured canonical HTTPS player is trusted', () => {
  assert.equal(player.href, PLAYER);
  for (const value of ['http://player.example/', 'https://player.example', 'https://player.example/?x=1', 'https://player.example/?', 'https://player.example/#x', 'https://u:p@player.example/', 'https://player.example:8443/', ' https://player.example/', 'https://player.example/a b', 'https://PLAYER.example/', undefined, 42])
    assert.equal(trustedPlayer(value), null, String(value));
});
test('the advertised signed live entry resolves only as one literal same-origin address', () => {
  assert.equal(resolveLiveURL(page(SIGNED), player, '/previous.xml'), SIGNED);
  assert.equal(resolveLiveURL(`<script>var event_xml_urls = {"live":"${SIGNED}","previous":"x"};</script>`, player, '/previous.xml'), SIGNED);
  assert.equal(resolveLiveURL(page('https://player.example/live.xml'), player, '/previous.xml'), 'https://player.example/live.xml');
  const rejected = {
    'other host': page('https://other.example/live.xml'), http: page('http://player.example/live.xml'), port: page('https://player.example:8443/live.xml'),
    'default port': page('https://player.example:443/live.xml'), userinfo: page('https://u@player.example/live.xml'), hash: page('https://player.example/live.xml#x'),
    'dot segment': page('https://player.example/a/../live.xml'), 'single dot': page('https://player.example/./live.xml'), 'encoded dot': page('https://player.example/%2e%2e/live.xml'),
    'player path': page('https://player.example/'), 'archive path': page('https://player.example/previous.xml'), relative: page('/live.xml'), 'scheme relative': page('//player.example/live.xml'),
    'upper host': page('https://PLAYER.example/live.xml'), 'escaped slash': page('https:\\/\\/player.example\\/live.xml'), entity: page('https://player.example/live.xml?a=1&amp;signature=x'),
    whitespace: page('https://player.example/live.xml?a= 1'), quote: page("https://player.example/live.xml?a='1'"), 'too long': page(`https://player.example/${'a'.repeat(2100)}`),
    'duplicate key': '<script>var event_xml_urls = {live: "https://player.example/a.xml", live: "https://player.example/b.xml"};</script>',
    'single quoted': "<script>var event_xml_urls = {live: 'https://player.example/a.xml'};</script>",
    'outside the map': '<script>var event_xml_urls = {previous: "x"}; var other = {live: "https://player.example/a.xml"};</script>',
    'two maps': page(SIGNED) + page(SIGNED), 'reassigned map': page(SIGNED) + '<script>event_xml_urls = {};</script>', 'no map': '<html></html>'
  };
  for (const [name, html] of Object.entries(rejected)) assert.equal(resolveLiveURL(html, player, '/previous.xml'), null, name);
});

const XML = feed(ev({ id: 's1', start: SHOW, sport: '898', opponent: null }) + ev({ id: 'g1' }));
const catalog = { archiveConfig: { dukePlayer: PLAYER, dukeFeedPath: '/previous.xml' } };
function provider({ html = page(SIGNED), xml = XML, liveHeaders = {}, wall = 1_800_000_000_000 } = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url) === PLAYER) return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    if (String(url) === SIGNED) return new Response(xml, { headers: liveHeaders });
    throw Error('unexpected request');
  };
  return { calls, fetcher, now: () => wall };
}
test('the broker makes exactly two metadata requests and returns only the sanitized projection with live-feed age', async () => {
  const wall = 1_800_000_000_000, p = provider({ wall, liveHeaders: { Date: new Date(wall - 2000).toUTCString(), Age: '3' } });
  const data = await brokerSchedule(SCHEDULE_ROUTE, { fetcher: p.fetcher, now: p.now, catalog });
  assert.deepEqual(data, { schemaVersion: 1, school: 'duke', state: 'upcoming', event: { id: 's1', label: 'Football Radio Show', kind: 'show', broadcastStart: SHOW * 1000 }, checkedAt: wall, ageMs: 4000 });
  assert.deepEqual(p.calls.map(call => call.url), [PLAYER, SIGNED]);
  for (const { init } of p.calls) {
    assert.deepEqual([init.credentials, init.cache, init.redirect], ['omit', 'no-store', 'manual']);
    assert.deepEqual(Object.keys(init.headers), ['Accept']);
  }
  for (const leaked of ['player.example', 'SECRET', 'signature', 'expires', 'media.example']) assert.ok(!JSON.stringify(data).includes(leaked), leaked);
  assert.equal(await brokerSchedule('/api/broadcast/schedule/vt', { fetcher: p.fetcher, catalog }), null);
});
test('missing Date makes age unknown, absent Age uses the existing optional-zero convention and malformed Age is unknown', async () => {
  const wall = 1_800_000_000_000;
  assert.equal((await brokerSchedule(SCHEDULE_ROUTE, { ...provider({ wall }), catalog })).ageMs, null);
  assert.equal((await brokerSchedule(SCHEDULE_ROUTE, { ...provider({ wall, liveHeaders: { Date: new Date(wall - 5000).toUTCString() } }), catalog })).ageMs, 6000);
  assert.equal((await brokerSchedule(SCHEDULE_ROUTE, { ...provider({ wall, liveHeaders: { Date: new Date(wall).toUTCString(), Age: 'soon' } }), catalog })).ageMs, null);
});
test('a fetched but invalid or uncertain feed is an explicit unknown result, never an empty listing', async () => {
  for (const [xml, reason] of [['<html>busy</html>', 'invalid'], [feed(ev({ start: EDT_4AM })), 'uncertain']]) {
    const data = await brokerSchedule(SCHEDULE_ROUTE, { ...provider({ xml }), catalog });
    assert.deepEqual([data.state, data.reason, data.event], ['unknown', reason, undefined]);
  }
  assert.equal((await brokerSchedule(SCHEDULE_ROUTE, { ...provider({ xml: feed('') }), catalog })).state, 'none-listed');
});
test('configuration, transport and bound failures throw fixed errors with no address, query or body', async () => {
  const records = [], diagnostic = record => records.push(record);
  const fails = async (options, name = 'Error') => {
    let calls = 0;
    const fetcher = options.fetcher ?? (async () => { calls++; throw Error('never'); });
    const error = await brokerSchedule(SCHEDULE_ROUTE, { catalog, diagnostic, ...options, fetcher: async (...args) => { calls++; return fetcher(...args); } }).then(() => null, value => value);
    assert.ok(error, 'must fail');
    assert.equal(error.name, name);
    for (const leaked of ['player.example', 'SECRET', 'signature', 'private body']) assert.ok(!String(error.message + error.stack).includes(leaked), leaked);
    return calls;
  };
  for (const config of [undefined, {}, { dukePlayer: 'http://player.example/' }, { dukePlayer: 'https://player.example/?x=1' }]) assert.equal(await fails({ catalog: config && { archiveConfig: config } }), 0);
  await fails({ fetcher: async () => { throw TypeError(`fetch failed for ${SIGNED}`); } });
  await fails({ fetcher: async () => new Response('private body', { status: 503 }) });
  await fails({ fetcher: async url => String(url) === PLAYER ? new Response(page(SIGNED)) : new Response(null, { status: 302, headers: { Location: SIGNED } }) });
  await fails({ fetcher: async () => Object.defineProperty(new Response(page(SIGNED)), 'redirected', { value: true }) });
  await fails({ fetcher: async () => new Response(page('https://other.example/live.xml')) });
  await fails({ fetcher: async () => new Response(new Uint8Array([0xff, 0xfe, 0xfd])) });
  await fails({ ...provider(), maxBytes: 64 });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await fails({ fetcher: () => new Promise(() => {}), timeoutMs: 15 }, 'TimeoutError');
    let cancelled = false;
    const hanging = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('<main>')); }, cancel() { cancelled = true; } }));
    await fails({ fetcher: async url => String(url) === PLAYER ? new Response(page(SIGNED)) : hanging(), timeoutMs: 15 }, 'TimeoutError');
    assert.equal(cancelled, true, 'the feed body is cancelled at the aggregate deadline');
    const controller = new AbortController();
    const reading = brokerSchedule(SCHEDULE_ROUTE, { catalog, signal: controller.signal, fetcher: async () => hanging() }).then(() => null, error => error);
    await new Promise(resolve => setImmediate(resolve)); controller.abort();
    assert.equal((await reading).message, 'schedule-unavailable');
  } finally { clearTimeout(keepAlive); }
  assert.ok(records.length > 0);
  assert.ok(records.every(record => record.stage === 'broadcast-schedule' && Object.keys(record).join() === 'stage,step,failure'));
  assert.ok(!JSON.stringify(records).includes('player.example') && !JSON.stringify(records).includes('SECRET'));
});
