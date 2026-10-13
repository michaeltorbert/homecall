// Selected-school appearance (issue #33). Pure: a curated palette per explicit school key, applied as
// CSS custom properties on the document root. Status, warnings, errors, links and focus never change.
//
// Each school has separate roles because one brand color cannot safely fill every role on graphite:
//   fill / fillHover  primary button background (normal and hover)
//   onFill            text on fill and fillHover
//   edge / edgeHover  primary button border; carries the 3:1 boundary when the fill is dark
//   ink               selected tab text and underline, menu check mark, recording ▶
//   range             range-input accent
// fill values are the schools' published colors (sources below, read 2026-10-12). Every other value
// that differs from a published color is a Homecall application tone chosen for contrast on graphite;
// none of them is an official school color or implies endorsement.
export const THEME_ROLES = Object.freeze({ fill: '--accent-fill', fillHover: '--accent-fill-hover', onFill: '--on-accent', edge: '--accent-edge',
  edgeHover: '--accent-edge-hover', ink: '--accent-ink', range: '--accent-range' });
const palette = roles => Object.freeze(roles);
export const schoolThemes = Object.freeze({
  // brand.duke.edu/colors: Royal #00539b, Navy #012169. Hover darkens to Navy (no opacity or lightening);
  // edge, ink and range keep Homecall's earlier #8daeff application tone.
  duke: palette({ fill: '#00539b', fillHover: '#012169', onFill: '#ffffff', edge: '#8daeff', edgeHover: '#b4c9ff', ink: '#8daeff', range: '#8daeff' }),
  // brand.gatech.edu/our-look/colors (2026 core): Gold #b39051 with dark text. Hover #c9a96b is an
  // application tone, not the gradient-only Light Gold.
  gt: palette({ fill: '#b39051', fillHover: '#c9a96b', onFill: '#10151e', edge: '#b39051', edgeHover: '#c9a96b', ink: '#b39051', range: '#b39051' }),
  // University signature green #005030 (cloud.outreach.miami.edu/dec-2025-wcag-compliance). Hover darkens;
  // edge, ink and range are light-green application tones.
  miami: palette({ fill: '#005030', fillHover: '#003f26', onFill: '#ffffff', edge: '#5fc48c', edgeHover: '#8fdcb0', ink: '#5fc48c', range: '#5fc48c' }),
  // brand.vt.edu 2019 campaign guidelines: Chicago Maroon #861f41, Burnt Orange #e87722. The guide permits
  // darkening, not lightening, the maroon; hover darkens it.
  vt: palette({ fill: '#861f41', fillHover: '#6b1934', onFill: '#ffffff', edge: '#e87722', edgeHover: '#f29a55', ink: '#e87722', range: '#e87722' }),
  // ocm.auburn.edu/brand-center: Orange #e86100 with dark text (color-accessibility table).
  auburn: palette({ fill: '#e86100', fillHover: '#f07a26', onFill: '#10151e', edge: '#e86100', edgeHover: '#f07a26', ink: '#e86100', range: '#e86100' }),
  // brand.virginia.edu/design-assets/colors: Orange #e57200 with #111111 text (accessible combinations).
  uva: palette({ fill: '#e57200', fillHover: '#ec8a33', onFill: '#111111', edge: '#e57200', edgeHover: '#ec8a33', ink: '#e57200', range: '#e57200' }),
});
// The neutral appearance for every school without a curated palette; style.css declares the same values
// on :root, so clearing the inline properties restores exactly this.
export const fallbackTheme = palette({ fill: '#c6ccd6', fillHover: '#dde1e8', onFill: '#10151e', edge: '#c6ccd6', edgeHover: '#dde1e8', ink: '#eceff3', range: '#c6ccd6' });
// Preview-only alternatives for the local appearance review. The app never reads these; production
// always uses schoolThemes.
export const previewVariants = Object.freeze({
  // Miami orange #f47321 with dark text, as the user's comparison against the default green.
  miami: Object.freeze({ orange: palette({ fill: '#f47321', fillHover: '#f68a45', onFill: '#10151e', edge: '#f47321', edgeHover: '#f68a45', ink: '#f47321', range: '#f47321' }) }),
});

// Only an own key of the curated map has a palette; catalog:<id>, inherited names and anything else get null.
export const schoolTheme = key => (typeof key === 'string' && Object.hasOwn(schoolThemes, key) ? schoolThemes[key] : null);

// Sets every role for a curated school, or clears every role (and the marker) so nothing of the previous
// school can remain.
export function applySchoolTheme(root, key) {
  const theme = schoolTheme(key);
  for (const [role, token] of Object.entries(THEME_ROLES)) {
    if (theme) root.style.setProperty(token, theme[role]); else root.style.removeProperty(token);
  }
  if (theme) root.dataset.school = key; else delete root.dataset.school;
}

// WCAG 2 contrast ratio of two #rrggbb colors.
export function contrastRatio(a, b) {
  const luminance = hex => {
    const [red, green, blue] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
