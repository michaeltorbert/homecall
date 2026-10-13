// Selected-school appearance (issue #33): palette contrast on the actual graphite backgrounds, the CSS fallback,
// fixed semantic colors and key resolution. Pure checks of declared values, not rendered browser pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { THEME_ROLES, schoolThemes, fallbackTheme, previewVariants, schoolTheme, applySchoolTheme, contrastRatio } from '../src/school-theme.js';
import { teams, catalogTeams } from '../src/teams.js';
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const block = selector => new RegExp(`${selector.replace(/[#.]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)[1];
const declarations = text => Object.fromEntries([...text.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
const root = declarations(block(':root'));
const resolve = (value, scope = {}) => { for (let i = 0; i < 5 && value?.startsWith('var('); i++) { const name = /^var\((--[\w-]+)\)$/.exec(value)[1]; value = scope[name] ?? root[name]; } return value; };
// Backgrounds each role actually sits on (style.css): page, owner strip, dialogs, menu, menu hover, tab hover.
const PAGE = '#111317', SURFACE = '#1b1f26', DIALOG = '#191d24', MENU = '#1c2028', MENU_HOVER = '#2b3240', TAB_HOVER = '#181c23';
const palettes = [...Object.entries(schoolThemes), ['fallback', fallbackTheme], ...Object.entries(previewVariants).flatMap(([key, set]) => Object.entries(set).map(([name, p]) => [`${key}-${name} (preview)`, p]))];
const atLeast = (a, b, min, what) => { const ratio = contrastRatio(a, b); assert.ok(ratio >= min, `${what}: ${a} on ${b} is ${ratio.toFixed(2)}:1, needs ${min}:1`); };

test('every curated palette, the fallback and the preview variant meet WCAG AA on the backgrounds they use, including hover', () => {
  for (const [name, p] of palettes) {
    for (const fill of [p.fill, p.fillHover]) atLeast(p.onFill, fill, 4.5, `${name} button text`);
    for (const edge of [p.edge, p.edgeHover]) for (const bg of [PAGE, SURFACE, DIALOG]) atLeast(edge, bg, 3, `${name} button boundary`);
    for (const bg of [PAGE, TAB_HOVER]) atLeast(p.ink, bg, 4.5, `${name} selected tab text`);
    for (const bg of [PAGE, MENU, MENU_HOVER]) atLeast(p.ink, bg, 3, `${name} check mark and recording marker`);
    atLeast(p.range, PAGE, 3, `${name} range accent`);
  }
});

test('the fixed focus ring, the recovery action inside warnings and links contrast on every background they meet', () => {
  assert.match(css, /:focus-visible \{ outline: 3px solid var\(--focus\); outline-offset: 3px; \}/, 'the ring stays offset onto the background, never on a fill');
  for (const bg of [PAGE, SURFACE, DIALOG, MENU, MENU_HOVER, root['--warn-bg']]) atLeast(root['--focus'], bg, 3, 'focus ring');
  const recovery = declarations(block('#recovery-actions'));
  for (const [role, token] of Object.entries(THEME_ROLES).filter(([role]) => ['fill', 'fillHover', 'onFill', 'edge', 'edgeHover'].includes(role)))
    assert.equal(resolve(recovery[token], recovery), fallbackTheme[role], `the recovery ${role} is the fixed neutral for every school`);
  atLeast(fallbackTheme.onFill, fallbackTheme.fill, 4.5, 'recovery text');
  atLeast(fallbackTheme.edge, root['--warn-bg'], 3, 'recovery boundary on the warning');
  for (const bg of [PAGE, DIALOG, root['--warn-bg']]) atLeast(root['--link'], bg, 4.5, 'link');
});

test('style.css declares the neutral fallback for every role, so clearing the inline tokens restores it completely', () => {
  for (const [role, token] of Object.entries(THEME_ROLES)) assert.equal(resolve(root[token]), fallbackTheme[role], token);
  assert.doesNotMatch(css, /color-mix\(/, 'no runtime color mixing');
  assert.doesNotMatch(css, /--blue|--on-blue/, 'no leftover single-accent tokens');
});

test('status, warnings, errors, success, links and focus stay fixed and outside the school roles', () => {
  const fixed = { '--info': '#8daeff', '--link': '#b9ceff', '--focus': '#e3e7ee', '--warn': '#ffcc92', '--warn-bg': '#33281e', '--warn-edge': '#d4a56a', '--warn-ink': '#f5d8b8',
    '--danger': '#ffb0b3', '--danger-line': '#8d4b51', '--success': '#c2dcc7' };
  for (const [token, value] of Object.entries(fixed)) { assert.equal(root[token], value, token); assert.ok(!Object.values(THEME_ROLES).includes(token), token); }
  assert.match(block('.dot'), /background: var\(--info\)/, 'the status dot is not a school color');
  assert.match(block('.switch-notice'), /border-left: 3px solid var\(--info\)/, 'the switch notice is not a school color');
  assert.match(css, /button\.danger \{ color: var\(--danger\); border-color: var\(--danger-line\); \}/, 'destructive actions stay outlined text');
  assert.match(css, /\.main-nav button\[aria-selected=true\]:hover \{ color: var\(--accent-ink\); border-bottom-color: var\(--accent-ink\); font-weight: 650; \}/, 'the selected tab keeps its underline and weight');
  assert.match(css, /button:disabled \{ opacity: 0\.42; cursor: default; \}/, 'disabled stays dimmed');
  assert.match(css, /button:active:not\(:disabled\) \{ transform: translateY\(1px\); \}/, 'pressed keeps its movement');
});

test('palettes exist only for the six configured and known catalog schools, by explicit key, with every role', () => {
  assert.deepEqual(Object.keys(schoolThemes).sort(), ['auburn', 'duke', 'gt', 'miami', 'uva', 'vt']);
  for (const key of Object.keys(schoolThemes)) assert.ok(Object.hasOwn(teams, key) || Object.hasOwn(catalogTeams, key), key);
  for (const [name, p] of palettes) {
    assert.ok(Object.isFrozen(p), name);
    assert.deepEqual(Object.keys(p).sort(), Object.keys(THEME_ROLES).sort(), name);
    for (const value of Object.values(p)) assert.match(value, /^#[0-9a-f]{6}$/, name);
  }
  assert.ok(Object.isFrozen(schoolThemes) && Object.isFrozen(previewVariants));
  assert.equal(schoolTheme('miami').fill, '#005030', 'production Miami is green; orange is preview-only');
  assert.ok(!Object.values(schoolThemes).includes(previewVariants.miami.orange));
});

test('unknown, catalog-only, inherited and malformed keys resolve to no palette', () => {
  for (const key of ['catalog:5f0c2a1e-3b4d-4c6e-8f90-a1b2c3d4e5f6', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'Duke', 'Virginia', '', ' duke', undefined, null, 42, {}, ['duke']])
    assert.equal(schoolTheme(key), null, String(key));
});

test('applying a theme sets every role; any unknown key clears every role and the marker, so nothing of the previous school remains', t => {
  const dom = new JSDOM('<!doctype html><html></html>'); t.after(() => dom.window.close());
  const el = dom.window.document.documentElement;
  const read = () => ({ school: el.dataset.school ?? null, ...Object.fromEntries(Object.entries(THEME_ROLES).map(([role, token]) => [role, el.style.getPropertyValue(token)])) });
  const none = Object.fromEntries([['school', null], ...Object.keys(THEME_ROLES).map(role => [role, ''])]);
  for (const key of ['miami', 'catalog:5f0c2a1e-3b4d-4c6e-8f90-a1b2c3d4e5f6', 'vt', '__proto__', 'gt', 'constructor', 'uva', 'toString']) {
    applySchoolTheme(el, key);
    assert.deepEqual(read(), schoolTheme(key) ? { school: key, ...schoolThemes[key] } : none, key);
  }
  applySchoolTheme(el, 'miami'); applySchoolTheme(el, 'miami');
  assert.deepEqual(read(), { school: 'miami', ...schoolThemes.miami }, 'repeating a school is stable');
  assert.equal(el.getAttribute('style').split(';').filter(Boolean).length, Object.keys(THEME_ROLES).length, 'only the role tokens are written');
});
