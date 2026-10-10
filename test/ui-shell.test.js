// Shell behavior against the real index.html: persistent controller DOM, prompts, menu, disclosures
// and warning mirrors. jsdom checks semantics and focus only; layout, 44px rendering and native
// dialog inertness need the browser screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createConfirm, setupShell, setDisclosure, mirrorWarnings, openDialog, closeDialog } from '../src/ui-shell.js';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const settle = () => new Promise(r => setImmediate(r));
function page(t) {
  const dom = new JSDOM(html, { url: 'https://example.test/homecall/', pretendToBeVisual: true }), w = dom.window, doc = w.document;
  t.after(() => w.close());
  return { w, doc, $: id => doc.getElementById(id), key: (el, key) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true })) };
}

test('index keeps every controller ID once, the signed control sets and no third navigation tab', t => {
  const { doc } = page(t);
  const ids = [...doc.querySelectorAll('[id]')].map(el => el.id);
  assert.equal(new Set(ids).size, ids.length, 'IDs are unique');
  for (const id of ['team', 'feed', 'feed-picker', 'game-panel', 'game', 'game-note', 'game-refresh', 'station', 'status', 'notice', 'connect', 'pause', 'stop', 'resume-position',
    'volume', 'hold', 'cancel', 'confirm', 'live', 'scrub', 'scrub-label', 'delay', 'buffer', 'alignment', 'sync-help', 'official', 'source-note', 'demo', 'provider', 'output', 'reason',
    'storage-warning', 'sessions', 'preview', 'log-summary', 'export', 'share', 'copy', 'download', 'share-status', 'clear', 'clear-confirm', 'build',
    'source-current', 'switch-notice', 'recover-note', 'game-status-help', 'timing-tools',
    'sync-mapped', 'sync-audio-time', 'sync-now', 'sync-range', 'sync-range-note', 'sync-mapping-note', 'sync-timing-retry', 'sync-timing-source', 'sync-clock-form', 'sync-clock-fields', 'sync-quarter',
    'sync-clock', 'sync-apply', 'sync-result', 'sync-matches', 'sync-offset',
    'archive-team', 'archive-sport', 'archive-year', 'archive-note', 'archive-retry', 'replay-player', 'replay-title', 'replay-audio', 'replay-speed', 'replay-hold', 'replay-resume', 'replay-stop',
    'replay-status', 'archive-list', 'archive-official', 'live-panel', 'archive-panel']) assert.ok(doc.getElementById(id), id);
  // One Listen route: the separate Game broadcasts panel, its element player and duplicate nudges are gone.
  for (const id of ['sync-panel', 'sync-audio', 'sync-play', 'sync-stop', 'sync-team', 'sync-game', 'sync-incoming', 'sync-playback']) assert.equal(doc.getElementById(id), null, id);
  assert.equal(doc.querySelectorAll('audio').length, 1, 'only the recordings element remains; Listen audio is owned by the PCM engine');
  assert.ok(doc.getElementById('matching').contains(doc.getElementById('timing-tools')), 'game timing lives in Match my TV');
  assert.equal(doc.getElementById('switch-notice').getAttribute('role'), 'status'); assert.equal(doc.getElementById('switch-notice').hasAttribute('data-warning-source'), false, 'the switch notice never replaces warnings');
  assert.deepEqual([...doc.querySelectorAll('[data-nudge]')].map(b => Number(b.dataset.nudge)), [-5, -1, -0.25, 0.25, 1, 5]);
  assert.equal(doc.querySelectorAll('[data-sync-nudge]').length, 0);
  assert.deepEqual([...doc.querySelectorAll('[data-replay-seek]')].map(b => Number(b.dataset.replaySeek)), [-15, -1, -0.25, 0.25, 1, 15]);
  assert.deepEqual([...doc.getElementById('replay-speed').options].map(o => o.value), ['0.75', '1', '1.25', '1.5', '2']);
  assert.deepEqual([...doc.querySelectorAll('[role=tab]')].map(tab => tab.textContent), ['Listen', 'Recordings']);
  assert.equal(doc.getElementById('sync-timing-source').value, '', 'timing source starts unset');
  assert.equal(doc.getElementById('replay-audio').hasAttribute('controls'), true);
  assert.equal(doc.querySelector('[data-sample], .preview-strip'), null, 'no design-preview scaffolding ships');
  for (const warning of ['storage-warning']) assert.equal(doc.getElementById(warning).closest('dialog, details, [role=menu]'), null, 'critical warnings live outside closed tools');
});

test('every menu item is reachable and every tool dialog has a close control and a read-only warning mirror', t => {
  const { doc } = page(t);
  const items = [...doc.querySelectorAll('#menu [role=menuitem]')].map(item => item.textContent.trim());
  assert.deepEqual(items, ['Radio stations', 'Game broadcasts', 'Reconnect audio', 'Open official player ↗', 'Listening help', 'Test context', 'Session logs', 'Test tone']);
  for (const item of doc.querySelectorAll('#menu [data-dialog]')) assert.equal(doc.getElementById(item.dataset.dialog)?.tagName, 'DIALOG', item.id);
  for (const dialog of doc.querySelectorAll('dialog')) {
    assert.ok(dialog.querySelector('[data-warning-mirror]'), dialog.id);
    assert.ok(dialog.querySelector('[data-close-dialog], #confirm-cancel'), dialog.id);
    assert.ok(dialog.getAttribute('aria-labelledby'), dialog.id);
  }
  assert.equal(doc.getElementById('official').target, '_blank');
});

test('prompt Continue runs synchronously in its click; Cancel, ×-less Escape and a newer prompt run nothing; focus returns', t => {
  const { $, doc, key } = page(t);
  const confirm = createConfirm(doc), calls = [];
  const opener = $('team'); opener.focus();
  confirm.ask({ title: 'Change team?', text: 'Audio stops.', action: 'Change team' }, () => calls.push('continue'), () => calls.push('cancel'));
  assert.equal($('confirm-dialog').hasAttribute('open'), true); assert.equal(confirm.pending, true);
  assert.equal($('confirm-title').textContent, 'Change team?'); assert.equal($('confirm-continue').textContent, 'Change team');
  assert.equal(doc.activeElement.id, 'confirm-cancel', 'the safe choice has focus');
  $('confirm-cancel').click();
  assert.deepEqual(calls, ['cancel']); assert.equal($('confirm-dialog').hasAttribute('open'), false); assert.equal(doc.activeElement, opener);
  confirm.ask({ title: 'A', text: '' }, () => calls.push('A'), () => calls.push('A canceled'));
  key($('confirm-dialog'), 'Escape');
  confirm.ask({ title: 'B', text: '' }, () => calls.push('B'));
  confirm.ask({ title: 'C', text: '' }, () => calls.push('C'));
  $('confirm-continue').click(); $('confirm-continue').click();
  assert.deepEqual(calls, ['cancel', 'A canceled', 'C'], 'Escape cancels, a newer prompt supersedes B, and a second Continue is stale');
  confirm.ask({ title: 'D', text: '' }, () => calls.push('D')); confirm.cancel();
  assert.deepEqual(calls.at(-1), 'C', 'invalidation runs nothing');
});

test('dialogs fall back to the open attribute without showModal and still return focus', t => {
  const { $, doc, w } = page(t);
  const dialog = $('logs-dialog');
  Object.defineProperty(dialog, 'showModal', { value: undefined }); Object.defineProperty(dialog, 'close', { value: undefined });
  $('more').focus(); openDialog(dialog);
  assert.equal(dialog.hasAttribute('open'), true); assert.ok(dialog.contains(doc.activeElement), 'focus moves into the dialog');
  dialog.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(dialog.hasAttribute('open'), false); assert.equal(doc.activeElement.id, 'more');
  openDialog(dialog); closeDialog(dialog); assert.equal(dialog.hasAttribute('open'), false);
});

test('More menu opens on its button, moves with arrows, closes on Escape and opens tool dialogs', t => {
  const { $, doc, key } = page(t);
  let opened = 0;
  setupShell({ doc, onMenuOpen: () => { opened++; } });
  $('more').click();
  assert.equal($('menu').hidden, false); assert.equal($('more').getAttribute('aria-expanded'), 'true'); assert.equal(opened, 1);
  assert.equal(doc.activeElement.id, 'nav-radio');
  key(doc.activeElement, 'ArrowDown'); assert.equal(doc.activeElement.id, 'nav-broadcasts');
  key(doc.activeElement, 'End'); assert.equal(doc.activeElement.id, 'menu-tone');
  key(doc.activeElement, 'ArrowDown'); assert.equal(doc.activeElement.id, 'nav-radio', 'arrows wrap');
  key(doc.activeElement, 'Escape'); assert.equal($('menu').hidden, true); assert.equal(doc.activeElement.id, 'more');
  key($('more'), 'ArrowDown'); assert.equal($('menu').hidden, false);
  $('menu-logs').click();
  assert.equal($('menu').hidden, true); assert.equal($('logs-dialog').hasAttribute('open'), true);
  doc.querySelector('#logs-dialog [data-close-dialog]').click(); assert.equal($('logs-dialog').hasAttribute('open'), false);
  $('more').click(); doc.body.click(); assert.equal($('menu').hidden, true, 'an outside click closes the menu');
});

test('disclosures swap the entry for the panel and Close returns focus to the entry', t => {
  const { $, doc } = page(t);
  setupShell({ doc });
  $('match-toggle').click();
  assert.equal($('matching').hidden, false); assert.equal($('match-toggle').hidden, true); assert.equal($('match-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(doc.activeElement.id, 'matching-title');
  $('match-close').click();
  assert.equal($('matching').hidden, true); assert.equal($('match-toggle').hidden, false); assert.equal(doc.activeElement.id, 'match-toggle');
  setDisclosure(doc, 'matching', true); assert.equal($('matching').hidden, false);
});

test('Homestream without a guard changes games and refreshes directly', async t => {
  const { metadataURL, mediaURL } = await import('../src/gateway.js');
  const source = readFileSync(new URL('../src/homestream-ui.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export function', 'function');
  const dom = new JSDOM(html, { url: 'https://example.test/homecall/', runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const win = dom.window, get = id => win.document.getElementById(id);
  const games = [{ id: 'now', start: Date.now(), url: 'https://gateway.example/media/game/team-id/now', opponent: 'Tennessee' }, { id: 'later', start: Date.now() + 864e5, url: null, opponent: 'Mercer' }];
  let reads = 0, stopped = 0;
  Object.assign(win, { AbortController, metadataURL, mediaURL, __GATEWAY_ORIGIN__: 'https://gateway.example', checkPlaylist: async () => 'ready',
    readJSON: async url => { reads++; return url.pathname.endsWith('/teams') ? [{ id: 'team-id', name: 'Georgia Tech' }] : games; } });
  win.eval(source + ';window.setup=setupHomestream;');
  const ui = win.setup({ onChange: () => { stopped++; }, onReady: () => {} });
  ui.setEnabled(true); await settle(); await settle();
  assert.equal(ui.ready.id, 'now');
  get('game').value = 'later'; await get('game').onchange();
  assert.equal(ui.ready, null); assert.equal(get('game').value, 'later'); assert.equal(stopped, 2);
  const before = reads; await get('game-refresh').onclick(); assert.equal(reads, before + 2, 'Refresh games reloads without a guard');
});
test('mirrors copy always-on warnings and flagged controller alerts only, and follow their sources', async t => {
  const { $, doc } = page(t);
  setupShell({ doc });
  const logs = () => doc.querySelector('#logs-dialog [data-warning-mirror]').textContent, strip = () => doc.querySelector('#owner-strip [data-warning-mirror]').textContent;
  $('notice').textContent = 'Routine notice'; $('replay-status').textContent = 'Playing recording.'; await settle();
  assert.equal(logs(), ''); assert.equal(strip(), '');
  $('notice').textContent = 'The source could not reconnect after three attempts.'; $('notice').dataset.alert = 'on';
  $('storage-warning').textContent = 'Playback positions could not be saved on this browser.'; await settle();
  assert.match(logs(), /could not be saved/); assert.match(logs(), /three attempts/);
  assert.equal(strip(), 'The source could not reconnect after three attempts.', 'the owner strip mirrors only the radio notice');
  $('replay-status').textContent = 'This recording could not play.'; $('replay-status').dataset.alert = 'on'; await settle();
  assert.match(logs(), /recording could not play/); assert.equal(strip(), 'The source could not reconnect after three attempts.', 'the owner strip still mirrors only the Listen notice');
  $('notice').dataset.alert = ''; $('replay-status').dataset.alert = ''; $('storage-warning').textContent = ''; await settle();
  assert.equal(logs(), ''); assert.equal(strip(), '');
  mirrorWarnings(doc); assert.equal(logs(), '');
});
