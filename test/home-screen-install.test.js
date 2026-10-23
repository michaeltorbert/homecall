// Add to Home Screen through the real shell, real index.html and the vendored component (#52).
// jsdom DOM-level evidence only: matchMedia and navigator.standalone are fixtures, getClientRects is
// faked for the rendered check and, where jsdom lacks it, showModal/close are a labeled shim. None of
// this is browser or native iPhone/iPad validation of launch mode, layout, focus or the guide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { setupShell } from '../src/ui-shell.js';
import { VERSION } from '../src/vendor/home-screen-install/home-screen-install.mjs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const vendor = new URL('../src/vendor/home-screen-install/', import.meta.url);
const STANDALONE = '(display-mode: standalone)';
const MENU = ['Radio stations', 'Game broadcasts', 'Reconnect audio', 'Open official player ↗', 'Listening help', 'Test context', 'Session logs', 'Test tone'];

// Shim, not the platform: only installed when this jsdom has no modal dialog support.
function shimDialog(w) {
  const proto = w.HTMLDialogElement.prototype;
  if (!('open' in proto)) Object.defineProperty(proto, 'open', { configurable: true, get() { return this.hasAttribute('open'); } });
  proto.showModal = function () { if (this.hasAttribute('open')) throw new w.DOMException('already open', 'InvalidStateError'); this.setAttribute('open', ''); };
  proto.close = function () { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
}

// Each fixture media query matches only its exact query string.
function page(t, { standalone, modes = [], referrer, storage = {} } = {}) {
  const dom = new JSDOM(html, { url: 'https://example.test/homecall/', pretendToBeVisual: true, ...(referrer ? { referrer } : {}) });
  const w = dom.window, doc = w.document, state = { standalone, modes: new Set(modes) }, lists = new Map();
  t.after(() => w.close());
  Object.defineProperty(w.navigator, 'standalone', { configurable: true, get: () => state.standalone });
  w.matchMedia = query => {
    if (!lists.has(query)) lists.set(query, Object.defineProperties(new w.EventTarget(), { media: { value: query }, matches: { get: () => state.modes.has(query) } }));
    return lists.get(query);
  };
  if (typeof w.HTMLDialogElement.prototype.showModal !== 'function') shimDialog(w);
  for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, value);
  const stored = () => JSON.stringify([w.localStorage, w.sessionStorage].map(s => Array.from({ length: s.length }, (_, i) => [s.key(i), s.getItem(s.key(i))]).sort()));
  return { w, doc, state, stored, $: id => doc.getElementById(id), mql: query => w.matchMedia(query) };
}

// Mounts through setupShell and fakes layout for the host and its button (jsdom renders nothing).
function shell(p, options = {}) {
  const ui = setupShell({ doc: p.doc, ...options });
  const host = p.doc.querySelector('footer > [data-home-screen-install]');
  const root = host?.shadowRoot, trigger = root?.querySelector('[part=button]');
  for (const el of [host, trigger]) if (el) el.getClientRects = () => [{ width: 160, height: 44 }];
  return { ui, host, root, trigger, dialog: root?.querySelector('dialog'), close: root?.querySelector('.close') };
}
const press = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, composed: true }));

test('the vendored module is the pinned release, byte for byte', () => {
  const lock = JSON.parse(readFileSync(new URL('home-screen-install.lock.json', vendor), 'utf8'));
  assert.equal(VERSION, lock.version);
  assert.equal(createHash('sha256').update(readFileSync(new URL(lock.file, vendor))).digest('hex'), lock.sha256);
});

test('setupShell mounts one real button as the last footer item, outside the menu, header and tab panels', t => {
  const p = page(t), { doc, $ } = p;
  const footerText = doc.querySelector('footer').textContent;
  const { ui, host, root, trigger, dialog } = shell(p);
  assert.ok(ui.homeScreen && typeof ui.homeScreen.open === 'function', 'the real vendor handle is returned');
  assert.equal(host.parentElement, doc.querySelector('footer')); assert.equal(doc.querySelector('footer').lastElementChild, host);
  // The footer (About, build, install) lives at the end of More, outside the menu, header, players and dialogs.
  assert.ok(host.closest('#more-view')); assert.equal(host.closest('header, [role=menu], [role=tabpanel], #live-panel, #archive-panel, dialog'), null);
  assert.equal(host.hidden, false);
  assert.equal(trigger.tagName, 'BUTTON'); assert.equal(trigger.textContent, 'Add to Home Screen');
  assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog'); assert.equal(trigger.hasAttribute('role'), false, 'no menu semantics');
  assert.equal(root.querySelectorAll('[part]').length, 1, 'only the button is a styling part');
  assert.equal(dialog.getAttribute('aria-labelledby'), 'hsi-title');
  assert.equal(doc.querySelector('footer').textContent, footerText, 'the footer text and #build are untouched');
  assert.ok($('build').parentElement === doc.querySelector('footer'));
  assert.deepEqual([...doc.querySelectorAll('#menu [role=menuitem]')].map(item => item.textContent.trim()), MENU);
  assert.deepEqual([...doc.querySelectorAll('dialog')].map(d => d.id), ['confirm-dialog', 'help-dialog', 'context-dialog', 'logs-dialog', 'favorite-dialog', 'tone-dialog'],
    'the shell only wires its own light-DOM dialogs, never the component guide');
  const again = setupShell({ doc });
  assert.equal(doc.querySelectorAll('footer > [data-home-screen-install]').length, 1, 'mounted once per footer');
  assert.equal(again.homeScreen, null);
});

test('only navigator.standalone === true or the exact standalone display mode hides the button', async t => {
  const cases = [
    ['normal browser tab', {}, false],
    ['navigator.standalone === true', { standalone: true }, true],
    ['display-mode: standalone only', { modes: [STANDALONE] }, true],
    ['navigator.standalone is the string "true"', { standalone: 'true' }, false],
    ['navigator.standalone is 1', { standalone: 1 }, false],
    ['navigator.standalone === false', { standalone: false }, false],
    ['display-mode: fullscreen', { modes: ['(display-mode: fullscreen)'] }, false],
    ['display-mode: minimal-ui', { modes: ['(display-mode: minimal-ui)'] }, false],
    ['a saved installation flag', { storage: { 'homecall:installed': 'true', installed: '1' } }, false],
    ['a Home Screen-looking referrer', { referrer: 'https://example.test/homecall/?source=homescreen' }, false],
  ];
  for (const [name, fixture, hidden] of cases) {
    await t.test(name, st => {
      const p = page(st, fixture), before = p.stored();
      if (fixture.referrer) assert.equal(p.doc.referrer, fixture.referrer);
      const { host } = shell(p);
      assert.equal(host.hidden, hidden);
      assert.equal(p.stored(), before, 'nothing is stored or removed');
    });
  }
});

test('the guide opens from the button, gives Share → Add to Home Screen steps and returns focus to the button', t => {
  const p = page(t), { w, doc } = p;
  const before = p.stored();
  const { root, trigger, dialog, close } = shell(p);
  doc.body.focus();
  press(w, trigger); // a clicked button may not take focus (Safari)
  assert.equal(dialog.open, true);
  const text = dialog.textContent;
  assert.match(root.getElementById('hsi-title').textContent, /^Add Homecall to your Home Screen$/);
  for (const words of [/Tap Share/, /Choose Add to Home Screen/, /Open as Web App/, /Tap Add, then open Homecall from your Home Screen/]) assert.match(text, words);
  assert.equal(close.textContent, 'Close');
  close.focus(); // stands in for the browser's modal focusing step, which jsdom does not run
  press(w, close);
  assert.equal(dialog.open, false);
  assert.equal(root.activeElement, trigger, 'focus returns to the button'); assert.equal(doc.activeElement, root.host);
  assert.equal(p.stored(), before);
});

test('display-mode changes close the guide and hide the button, and showing again needs no reload', t => {
  const p = page(t), { w, doc, state } = p;
  const { host, root, trigger, dialog } = shell(p);
  trigger.focus(); press(w, trigger); assert.equal(dialog.open, true);
  assert.ok(root.activeElement, 'focus is inside the component before the switch');
  state.modes.add(STANDALONE); p.mql(STANDALONE).dispatchEvent(new w.Event('change'));
  assert.equal(host.hidden, true); assert.equal(dialog.open, false, 'the open guide closes');
  assert.equal(root.activeElement, null, 'focus leaves the hidden button');
  state.modes.delete(STANDALONE); w.dispatchEvent(new w.Event('pageshow'));
  assert.equal(host.hidden, false);
  state.standalone = true; doc.dispatchEvent(new w.Event('visibilitychange'));
  assert.equal(host.hidden, true);
  state.standalone = undefined; doc.dispatchEvent(new w.Event('visibilitychange'));
  assert.equal(host.hidden, false);
});

test('pressing the button with More open closes the menu and opens only the guide', t => {
  const p = page(t), { w, doc, $ } = p;
  const { trigger, dialog } = shell(p);
  $('more').click(); assert.equal($('menu').hidden, false);
  press(w, trigger);
  assert.equal($('menu').hidden, true, 'the outside click closes the menu'); assert.equal($('more').getAttribute('aria-expanded'), 'false');
  assert.equal(dialog.open, true);
  assert.equal(doc.querySelector('dialog[open]'), null, 'no shell dialog opened');
});

test('a failing mount leaves the shell, menu, disclosures and footer working without the button', t => {
  const p = page(t), { doc, $ } = p;
  let calls = 0;
  const { ui, host } = shell(p, { mountHomeScreen: () => { calls++; throw new Error('fixture mount failure'); } });
  assert.equal(calls, 1); assert.equal(host, null); assert.equal(ui.homeScreen, null);
  assert.ok($('build'));
  $('more').click(); assert.equal($('menu').hidden, false); assert.equal(doc.activeElement.id, 'nav-radio');
  $('menu-logs').click(); assert.equal($('logs-dialog').hasAttribute('open'), true);
  doc.querySelector('#logs-dialog [data-close-dialog]').click(); assert.equal($('logs-dialog').hasAttribute('open'), false);
  $('match-toggle').click(); assert.equal($('matching').hidden, false);
});
