// Selected-school appearance (issue #33): every production role on the B · School night planes each school actually
// uses, read from style.css (canvas, surface, dialog, menu, hover), plus the graphite fallback, fixed semantic colors,
// field boundaries and key resolution. Pure checks of declared values; rendered pixels are audited separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { THEME_ROLES, schoolThemes, fallbackTheme, previewVariants, schoolTheme, applySchoolTheme, contrastRatio } from '../src/school-theme.js';
import { teams, catalogTeams } from '../src/teams.js';
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A rule's body by its exact selector at the start of a line; a missing rule fails, so no appearance selector is lost.
const rule = selector => { const m = new RegExp(`^${escape(selector)}\\s*\\{([^}]*)\\}`, 'm').exec(css); assert.ok(m, `style.css keeps ${selector}`); return m[1]; };
const prop = (body, name) => new RegExp(`(?:^|[\\s;{])${name}:\\s*([^;]+);`).exec(body)?.[1].trim();
const declarations = text => Object.fromEntries([...text.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
const root = declarations(rule(':root'));
const resolve = (value, scope = {}) => { for (let i = 0; i < 5 && value?.startsWith('var('); i++) { const name = /^var\((--[\w-]+)\)$/.exec(value)[1]; value = scope[name] ?? root[name]; } return value; };
const schoolBlocks = Object.fromEntries([...css.matchAll(/^:root\[data-school="([\w-]+)"\]\s*\{([^}]*)\}/gm)].map(m => [m[1], declarations(m[2])]));
const PLANE_TOKENS = ['--school-canvas', '--surface', '--surface-hover', '--line', '--field-line'];

// The backgrounds a school's roles actually sit on. Curated schools use their B block and the :root[data-school]
// overrides; the fallback (no marker) uses the graphite rules.
function planes(key) {
  const themed = key !== 'fallback', scope = themed ? schoolBlocks[key] : {};
  const bg = (base, override) => resolve(prop(rule(themed ? override : base), 'background'), scope);
  return {
    canvas: themed ? resolve(prop(rule(':root[data-school]'), 'background'), scope) : prop(rule(':root'), 'background'),
    surface: resolve('var(--surface)', scope), surfaceHover: resolve('var(--surface-hover)', scope),
    field: resolve(prop(rule('select, input:not([type=range]), textarea'), 'background'), scope),
    dialog: bg('dialog', ':root[data-school] dialog'),
    menu: bg('#menu', ':root[data-school] #menu'),
    menuHover: bg('#menu button:hover:not(:disabled), #menu a:hover', ':root[data-school] #menu :is(button, a):hover:not(:disabled)'),
    tabHover: bg('.main-nav button:hover:not(:disabled)', ':root[data-school] .main-nav button:hover:not(:disabled)'),
  };
}
const production = [...Object.entries(schoolThemes), ['fallback', fallbackTheme]].map(([key, palette]) => ({ key, palette, p: planes(key) }));
const atLeast = (a, b, min, what) => { const ratio = contrastRatio(a, b); assert.ok(ratio >= min, `${what}: ${a} on ${b} is ${ratio.toFixed(3)}:1, needs ${min}:1`); };
const fixed = name => root[name];

test('the B blocks in style.css and the curated palette map name exactly the same schools, each with every plane', () => {
  assert.deepEqual(Object.keys(schoolBlocks).sort(), Object.keys(schoolThemes).sort(), 'a curated key without a CSS block would leave --school-canvas undefined');
  for (const [key, block] of Object.entries(schoolBlocks)) {
    assert.deepEqual(Object.keys(block).sort(), [...PLANE_TOKENS].sort(), `${key} declares only the plane tokens`);
    for (const value of Object.values(block)) assert.match(value, /^#[0-9a-f]{6}$/, key);
  }
  for (const { key, p } of production) for (const [plane, value] of Object.entries(p)) assert.match(value ?? '', /^#[0-9a-f]{6}$/, `${key} ${plane} resolves to a color`);
});

test('school-colored roles meet WCAG AA on each school\'s own B planes, including hover', () => {
  for (const { key, palette: r, p } of production) {
    // Primary buttons are identified by their text on the fill; no outer boundary is required of them.
    for (const fill of [r.fill, r.fillHover]) atLeast(r.onFill, fill, 4.5, `${key} primary button text`);
    // Selected tab text and its underline, normal and hovered; the recording marker on the canvas.
    for (const bg of [p.canvas, p.tabHover]) atLeast(r.ink, bg, 4.5, `${key} selected tab`);
  }
});

test('range sliders draw a fixed track and a ringed thumb that contrast with each other and every plane', () => {
  const range = rule('input[type=range]');
  assert.match(range, /-webkit-appearance: none;\s*appearance: none;/); assert.match(range, /min-height: 44px;/, 'the 44px target stays');
  for (const selector of ['input[type=range]::-webkit-slider-runnable-track', 'input[type=range]::-moz-range-track'])
    assert.equal(prop(rule(selector), 'background'), 'var(--range-track)', selector);
  for (const selector of ['input[type=range]::-webkit-slider-thumb', 'input[type=range]::-moz-range-thumb']) {
    assert.equal(prop(rule(selector), 'border'), '2px solid var(--range-thumb-edge)', selector);
    assert.equal(prop(rule(selector), 'background'), 'var(--accent-range)', `${selector} keeps the school accent inside the ring`);
  }
  // The track shows the slider's extent (also at 0); the ring identifies the thumb against the track and the page.
  // The accent center needs no contrast of its own, and the value is shown by the thumb position and the visible text.
  atLeast(fixed('--range-thumb-edge'), fixed('--range-track'), 3, 'thumb ring on the track');
  for (const { key, p } of production) for (const bg of [p.canvas, p.surface]) {
    atLeast(fixed('--range-track'), bg, 3, `${key} range track`); atLeast(fixed('--range-thumb-edge'), bg, 3, `${key} thumb ring`);
  }
});

test('neutral text, links, semantic text and the focus ring contrast on every B plane they meet, including hover', () => {
  for (const { key, p } of production) {
    for (const bg of [p.canvas, p.surface, p.surfaceHover, p.dialog, p.menu, p.menuHover]) {
      atLeast(fixed('--ink'), bg, 4.5, `${key} text`); atLeast(fixed('--muted'), bg, 4.5, `${key} secondary text`);
      atLeast(fixed('--focus'), bg, 3, `${key} focus ring`);
    }
    for (const bg of [p.canvas, p.surface, p.dialog]) atLeast(fixed('--link'), bg, 4.5, `${key} link`);
    atLeast(fixed('--danger'), p.surface, 4.5, `${key} destructive action text`);
    atLeast(prop(rule('.icon-button'), 'color'), p.canvas, 4.5, `${key} More •••`);
  }
  atLeast(fixed('--focus'), fixed('--warn-bg'), 3, 'focus ring on warnings');
  atLeast(fixed('--link'), fixed('--warn-bg'), 4.5, 'link in warnings');
  atLeast(fixed('--warn-ink'), fixed('--warn-bg'), 4.5, 'warning text');
  atLeast(resolve(prop(rule('.switch-notice'), 'color')), prop(rule('.switch-notice'), 'background'), 4.5, 'switch notice text');
  assert.match(css, /:focus-visible \{ outline: 3px solid var\(--focus\); outline-offset: 3px; \}/, 'the ring stays offset onto the background, never on a fill');
});

test('text fields and selects keep a fixed 3:1 boundary and 4.5:1 placeholder on every school plane', () => {
  const field = rule('select, input:not([type=range]), textarea');
  assert.equal(prop(field, 'border'), '1px solid var(--field-edge)', 'fields use the dedicated boundary, not the decorative --field-line');
  assert.equal(prop(rule('::placeholder'), 'color'), 'var(--placeholder)');
  for (const block of Object.values(schoolBlocks)) assert.ok(!('--field-edge' in block) && !('--placeholder' in block), 'no school overrides the field roles');
  for (const { key, p } of production) {
    // The boundary meets the fill inside and whatever plane surrounds the field (page, dialog or surface).
    for (const bg of [p.field, p.canvas, p.surface, p.dialog]) atLeast(fixed('--field-edge'), bg, 3, `${key} field boundary`);
    atLeast(fixed('--placeholder'), p.field, 4.5, `${key} placeholder`);
    atLeast(fixed('--ink'), p.field, 4.5, `${key} field value`);
  }
  // Decorative container edges keep their B tokens.
  assert.equal(prop(rule(':root[data-school] #menu'), 'border-color'), 'var(--field-line)');
  assert.equal(prop(rule(':root[data-school] dialog'), 'border-color'), 'var(--field-line)');
});

test('the recovery action inside warnings is the fixed neutral for every school', () => {
  const recovery = declarations(rule('#recovery-actions'));
  for (const [role, token] of Object.entries(THEME_ROLES).filter(([role]) => ['fill', 'fillHover', 'onFill', 'edge', 'edgeHover'].includes(role)))
    assert.equal(resolve(recovery[token], recovery), fallbackTheme[role], `the recovery ${role} is the fixed neutral for every school`);
  for (const fill of [fallbackTheme.fill, fallbackTheme.fillHover]) atLeast(fallbackTheme.onFill, fill, 4.5, 'recovery text');
});

test('preview-only palettes meet the same roles on the Miami B planes they are previewed on (not production)', () => {
  const p = planes('miami');
  for (const [name, r] of Object.entries(previewVariants.miami)) {
    for (const fill of [r.fill, r.fillHover]) atLeast(r.onFill, fill, 4.5, `miami-${name} (preview) button text`);
    for (const bg of [p.canvas, p.tabHover]) atLeast(r.ink, bg, 4.5, `miami-${name} (preview) selected tab`);
  }
});

test('style.css declares the neutral fallback for every role, so clearing the inline tokens restores it completely', () => {
  for (const [role, token] of Object.entries(THEME_ROLES)) assert.equal(resolve(root[token]), fallbackTheme[role], token);
  assert.doesNotMatch(css, /color-mix\(/, 'no runtime color mixing');
  assert.doesNotMatch(css, /--blue|--on-blue/, 'no leftover single-accent tokens');
});

test('status, warnings, errors, links, focus, field and range roles stay fixed and outside the school roles', () => {
  const values = { '--info': '#8daeff', '--link': '#b9ceff', '--focus': '#e3e7ee', '--warn': '#ffcc92', '--warn-bg': '#33281e', '--warn-edge': '#d4a56a', '--warn-ink': '#f5d8b8',
    '--danger': '#ffb0b3', '--danger-line': '#8d4b51', '--success': '#c2dcc7', '--field-edge': '#6e7889', '--placeholder': '#858d99', '--range-track': '#6e7889', '--range-thumb-edge': '#eceff3' };
  for (const [token, value] of Object.entries(values)) {
    assert.equal(root[token], value, token); assert.ok(!Object.values(THEME_ROLES).includes(token), token);
    for (const block of Object.values(schoolBlocks)) assert.ok(!(token in block), `${token} is not a school plane`);
  }
  assert.match(rule('.dot'), /background: var\(--info\)/, 'the status dot is not a school color');
  assert.match(rule('.switch-notice'), /border-left: 3px solid var\(--info\)/, 'the switch notice is not a school color');
  assert.match(css, /button\.danger \{ color: var\(--danger\); border-color: var\(--danger-line\); \}/, 'destructive actions stay outlined text');
});

test('hover, pressed, selected and disabled appearance rules are all still present', () => {
  assert.match(rule('.main-nav button[aria-selected=true],\n.main-nav button[aria-selected=true]:hover'), /color: var\(--accent-ink\); border-bottom-color: var\(--accent-ink\); font-weight: 650;/, 'the selected tab keeps its underline and weight');
  assert.match(rule('button:hover:not(:disabled)'), /background: var\(--surface-hover\)/);
  assert.match(rule('button.primary:hover:not(:disabled)'), /background: var\(--accent-fill-hover\)/);
  assert.match(rule('button.quiet:hover:not(:disabled)'), /color: var\(--ink\)/);
  assert.match(rule('button:active:not(:disabled)'), /transform: translateY\(1px\)/, 'pressed keeps its movement');
  assert.match(rule('button:disabled'), /opacity: 0\.42; cursor: default;/, 'disabled stays dimmed');
  assert.match(rule('select:disabled, input:disabled:not([type=range])'), /opacity: 0\.55/);
  assert.match(rule('input[type=range]:disabled'), /opacity: 0\.5/);
  assert.match(rule(':is(.transport, .hold-area, .sync-clock-form) button.primary:disabled'), /background: transparent;/);
  for (const selector of ['#menu [aria-current=true]::after', '.archive-list button::after', 'summary::after', ':root[data-school] #menu :is(button, a):hover:not(:disabled)']) rule(selector);
});

test('palettes exist only for the six configured and known catalog schools, by explicit key, with every role', () => {
  const palettes = [...Object.entries(schoolThemes), ['fallback', fallbackTheme], ...Object.entries(previewVariants.miami).map(([name, p]) => [`miami-${name} (preview)`, p])];
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
test('the Home hero uses the brand fill roles with on-fill text, never the lighter ink or an overlay (issue #67)', () => {
  const hero = [...css.matchAll(/^\.home-hero \{([^}]*)\}/gm)].at(-1)[1];
  assert.match(hero, /var\(--accent-fill\)/); assert.match(hero, /var\(--accent-fill-hover\)/); assert.match(hero, /color: var\(--on-accent\)/);
  assert.doesNotMatch(hero, /accent-ink|#0005|repeating-linear-gradient/);
  assert.deepEqual([schoolThemes.duke.fill, schoolThemes.duke.fillHover], ['#00539b', '#012169'], 'Duke Royal to Navy');
  for (const [key, theme] of [...Object.entries(schoolThemes), ['fallback', fallbackTheme]])
    for (const fill of [theme.fill, theme.fillHover]) assert.ok(contrastRatio(fill, theme.onFill) >= 4.5, `${key} ${fill}`);
});
