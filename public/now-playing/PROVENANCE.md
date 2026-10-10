# Homecall Now Playing artwork provenance (issue #19)

## Decision

Now Playing uses five original Homecall images. Each is a 512 × 512 opaque PNG.

| Image | Used for |
| --- | --- |
| `duke-512.png` | Radio stations, Game broadcasts and Recordings whose selected school is exactly "Duke" |
| `miami-512.png` | The same, for "Miami" |
| `vt-512.png` | The same, for "Virginia Tech" |
| `gt-512.png` | The same, for "Georgia Tech" |
| `homecall-512.png` | Test tone, any other or missing school, and any identity without a school |

**School matching.** The school is the one frozen when playback starts. It is matched against
the app's own team names in `src/teams.js`:

- the match ignores leading and trailing spaces and letter case, and must cover the whole name;
- there is no prefix, substring, punctuation or fuzzy matching, so "Virginia", "Miami (OH)" and
  "Miami (FL)" all get the generic image;
- opponents, station titles and albums never select an image.

**Accepted residual.** Bare "Miami" means Miami (FL) everywhere in Homecall. If a provider ever
labels Miami (OH) as plain "Miami", that identity would get the Miami image.

**How the image is served.** The app resolves the image against the deployed page base, for
example `https://michaeltorbert.github.io/homecall/now-playing/gt-512.png` in production. It is
a same-origin static file. The runtime never uses:

- the SVG sources;
- a blob or data URL;
- a provider or CDN logo;
- a private address or a proxy.

No score or other volatile data is ever drawn into an image. The image for a session stays the
same while its score text changes.

**No team or provider marks.** These images are not team logos:

- no logo, monogram, lettermark, mascot, wordmark imitation or official color set;
- no redistribution of logo bytes, and no fetching of them at build or run time.

Provider responses do contain logo URLs. The status envelope drops them, and the client never
requests them.

## Sources

Each PNG has a complete SVG source in this directory:

- `homecall-512.svg` was authored for Homecall from SVG primitives only: two rectangles, two
  stroked paths (a house), a circle and two arcs (a broadcast call).
- The four team SVGs (`duke-512.svg`, `miami-512.svg`, `vt-512.svg`, `gt-512.svg`) are original
  work for this repository.

**Generic image.** It has no text, fonts, embedded images, filters or external references. Its
colors come from the app's own stylesheet:

- `#10151e` background;
- `#18202d` panel;
- `#ecf0f7` foreground;
- `#8daeff` default accent.

**Team images.** Each one has the same background and panel, plus the generic house-and-call
mark reduced to 46%. Under the mark is the plain school name in capitals, written out in full:
DUKE, MIAMI, VIRGINIA / TECH or GEORGIA / TECH.

- **Lettering.** The letters are original monoline geometric strokes (lines, elliptical arcs,
  round caps), hand-specified as SVG path data. There is no `<text>` element and no font, so
  rendering does not depend on installed fonts. No letters are combined into a monogram.
- **Color.** The call mark and lettering use Homecall's existing per-team accent from
  `src/teams.js`: Duke `#8daeff`, Miami `#ffaf70`, Virginia Tech `#ed9dab` and Georgia Tech
  `#d9bc7a`. These are not official team color specifications.
- **Safe area.** All content stays inside the central area of roughly 70%, so round or
  rounded-corner crops keep it.

All five backgrounds are opaque, so platform corner masks never reveal transparency.

## Derivation of the generic image (performed by the release root, not the author)

The release root rasterized the unchanged generic SVG on 2026-10-07. It used headless Chrome
driven by a locally available Playwright browser session. Playwright is not a Homecall
dependency, and nothing was added to `package.json`. The page used device scale factor 1
and a 512 × 512 viewport. Its content was an HTML wrapper with zero margins and a
512 × 512, overflow-hidden `html`/`body`, followed by the SVG source verbatim. The
screenshot was taken with animations disabled and `omitBackground: false`.

An equivalent reproducible variant, run from the repository root with any Playwright
installation available outside this project:

```js
// node rasterize.mjs  (Playwright resolved from the caller's environment, not this repo)
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const svg = readFileSync('public/now-playing/homecall-512.svg', 'utf8');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:512px;height:512px;overflow:hidden}</style></head><body>${svg}</body></html>`);
writeFileSync('public/now-playing/homecall-512.png', await page.screenshot({ animations: 'disabled', omitBackground: false }));
await browser.close();
```

Verification performed by the root:

- PNG signature and IHDR read: 512 × 512, bit depth 8, color type 2 (RGB). There is no
  alpha channel and no `tRNS` chunk, so the image is opaque.
- The pixels were readable and were inspected.

| Field | Value |
| --- | --- |
| Rasterized by | Release root, headless Chrome via a Playwright CLI browser session |
| Chrome version | 154.0.8037.98 |
| Viewport / scale | 512 × 512, device scale factor 1 |
| Source SVG SHA-256 | `57ec6d27b32b94c565fde3d7d5bb3fa33162c952ad5748eeeca058b8ef7ea8a4` |
| PNG SHA-256 | `51bcc5af2d693d8d4615329dd5c21384f3a9e32884ae3a2304a2ababf3431b85` |
| PNG size | 7,901 bytes |
| Dimensions / color type | 512 × 512, 8-bit RGB (color type 2), no alpha or `tRNS` |
| Local served check (2026-10-07, release root) | `GET http://127.0.0.1:4179/now-playing/homecall-512.png` and `GET http://127.0.0.1:4179/homecall/now-playing/homecall-512.png`: both HTTP 200, `image/png`, 7,901 bytes, SHA-256 `51bcc5af2d693d8d4615329dd5c21384f3a9e32884ae3a2304a2ababf3431b85` |
| Production Pages served check | Pending under BACKLOG NOW-PLAYING-RELEASE-01; not performed |

## Derivation of the team images (performed by the coordinator, not the author)

The team PNGs are rendered with `rasterize-artwork.mjs`. The author wrote that script; it is
kept with the evidence outside this repository and is not shipped. It uses the same HTML wrapper,
viewport, scale and screenshot options as the generic image, in native headless Chrome with
process-scoped `--mute-audio` verified. All network access is aborted during rendering.

The script then checks the result and records it:

- it renders each SVG twice and requires byte-identical output;
- it validates each PNG: signature, 512 × 512, 8-bit, not interlaced, no `tRNS`, and either RGB
  or RGBA with every alpha byte 255;
- it measures the bounding box of non-background pixels;
- it confirms that the generic files are unchanged;
- it regenerates the table below.

`test/now-playing-artwork.test.js` checks the committed files against this table.

<!-- team-artwork-hashes:start -->

| Image | Source SVG SHA-256 | PNG SHA-256 | PNG bytes | Dimensions / color type | Non-background content box (x0,y0)-(x1,y1) |
| --- | --- | --- | --- | --- | --- |
| `duke-512.png` | `6f7ceb5379845f2c49390d8567d834e28adb6d79e2c22263b3994e3b2fdcb97e` | `f19c23efffdaf99789913a34be628b6a44c062d9aab8baafb676312a1c468304` | 8,468 | 512 × 512, 8-bit RGB (color type 2), no `tRNS` | (100,94)-(411,374) |
| `miami-512.png` | `c9da1098a1f2c6a17024f487343db5ff24b64d8e61eb5e5823cbf3ad4c487709` | `dc6cb4146738c483adb940d17ee6ed49239679ed141d773e5453920c8be4f509` | 9,054 | 512 × 512, 8-bit RGB (color type 2), no `tRNS` | (99,94)-(412,374) |
| `vt-512.png` | `996c9373bf735c8d2a9a4a3c49cb1d22537cb7447957620a4d79c7dfcc93e5ba` | `7954b7a52cd256695f220cb205e60ee2e3e58062013da9ec114a474509ae9fc5` | 11,066 | 512 × 512, 8-bit RGB (color type 2), no `tRNS` | (96,94)-(415,400) |
| `gt-512.png` | `e1685909d6b8a99656d028f566d03ea03fd66cd329ab76e60d01d5270aeeb6f0` | `6a5e23cda503b92301f20b5bfc667bcaf8b70348c419c0d428b966a35018fb44` | 10,626 | 512 × 512, 8-bit RGB (color type 2), no `tRNS` | (94,94)-(417,396) |

| Field | Value |
| --- | --- |
| Rasterized with | Headless Chrome (native channel) 154.0.8037.98, process-scoped `--mute-audio` verified, network aborted |
| Viewport / scale | 512 × 512, device scale factor 1, zero-margin HTML wrapper, `omitBackground: false` |
| Rasterizer | `research/tonight-polish-2026-10-09/rasterize-artwork.mjs` (outside the repository), SHA-256 `a342486640ab3f59fae2585dcc15229d46c26c1e64b39bc2f308a071e74d49c2` |
| Repeat render | Each SVG rendered twice in fresh contexts; byte-identical |
| Generic image | `homecall-512.svg` `57ec6d27b32b94c565fde3d7d5bb3fa33162c952ad5748eeeca058b8ef7ea8a4` and `homecall-512.png` `51bcc5af2d693d8d4615329dd5c21384f3a9e32884ae3a2304a2ababf3431b85` verified unchanged |

<!-- team-artwork-hashes:end -->

## What these checks do not prove

Browser functional checks of the served files (HTTP 200, `image/png`, dimensions) and local
browser renderings are not native lock-screen or car approval (BACKLOG NOW-PLAYING-01). How a
phone, watch or car crops, scales, caches or omits this artwork is unverified until it is tested
on actual devices.

If any SVG or PNG changes, its hashes must be re-recorded.
