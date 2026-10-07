# Homecall Now Playing artwork provenance (issue #19)

## Decision

Every Now Playing mode (Live radio, Live game, Sync, Archive and the timing demo) and every
school uses one original Homecall image: `homecall-512.png`, a 512 × 512 opaque PNG.
The app resolves it against the deployed page base
(`https://michaeltorbert.github.io/homecall/now-playing/homecall-512.png` in production). It
is a same-origin static file. The runtime never uses the SVG, a blob or data URL, a provider
or CDN logo, a private address or a proxy, and never draws a score into the image.

This release ships no team or provider marks:

- no per-team artwork map;
- no imitation of team branding;
- no redistribution of logo bytes, and no fetching of them at build or run time.

Provider responses do contain logo URLs. The status envelope drops them, and the client
never requests them. Team-specific artwork remains a follow-up (BACKLOG NOW-PLAYING-ART-01),
pending appropriate source and rights review and native-surface verification.

## Source

`homecall-512.svg` in this directory is the complete source. It was authored for Homecall
from SVG primitives only: two rectangles, two stroked paths (a house), a circle and two arcs
(a broadcast call). It has no text, fonts, embedded images, filters or external references.
The colors come from the app's own stylesheet: `#10151e` background, `#18202d` panel,
`#ecf0f7` foreground and `#8daeff` default accent. The background is opaque, so platform
corner masks never reveal transparency. There are no team colors.

## Derivation (performed by the release root, not the author)

The release root rasterized the unchanged SVG on 2026-10-07. It used headless Chrome
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

Browser functional checks of the served file (HTTP 200, `image/png`, dimensions) are not
native lock-screen or car approval (BACKLOG NOW-PLAYING-01).

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

If the SVG or PNG changes, both hashes must be re-recorded.
