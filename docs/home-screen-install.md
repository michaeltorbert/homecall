# Home Screen Install (vendored)

`src/vendor/home-screen-install/` holds a vendored copy of the ES module from
[michaeltorbert/home-screen-install](https://github.com/michaeltorbert/home-screen-install).
It sits outside `public/`, so Vite includes it only once client code imports it.

## In Homecall

`setupShell` in `src/ui-shell.js` mounts one **Add to Home Screen** button as
the last item of the page `<footer>`, on its own row, outside the More menu and
the tab panels. It is bundled with the app; if `mount()` throws, the shell and
playback setup continue without the button.

- The component alone decides visibility, from the current window only:
  hidden while `navigator.standalone === true` or
  `(display-mode: standalone)` matches, shown otherwise. Homecall stores no
  installation flag and reads no referrer or fullscreen state, so the button
  still appears in a Safari tab after a Home Screen icon exists.
- Selecting it opens the component's own Share → Add to Home Screen guide
  (a modal dialog in its shadow root). Nothing is installed programmatically.
- Styling uses only the documented `--hsi-*` variables on `footer` and
  `::part(button)` in `style.css`. The guide keeps 15px text; only the button
  uses the footer's 13px scale.
- No manifest, icons or extra `<head>` metadata are added. The local server
  (`server.mjs`) would not serve a manifest or icons, so add them only if
  native testing shows standalone launch needs them.

`test/home-screen-install.test.js` covers this at DOM level in jsdom. Launch
mode, layout and the guide on iPhone and iPad need Safari or the Apple
Simulator; #52 stays open until both are verified.

## Files

| File | Purpose |
| --- | --- |
| `home-screen-install.mjs` | ES module from the pinned release |
| `SHA256SUMS` | The release's checksums for both formats; only the ES module entry is used here |
| `home-screen-install.lock.json` | Pin: version, tag, full source commit, format and script SHA-256 |

Do not edit these files by hand. Check them offline with:

```sh
npm run check:home-screen-install
```

The same check runs on every pull request and push to `main` in
`.github/workflows/home-screen-install.yml`. It verifies only the vendored
files. The existing test and Pages workflow is unchanged and still deploys only
from `main`.

## Updates

A local daily job proposes newer stable releases as pull requests titled
“Update home-screen-install to vX.Y.Z”. Each one changes only the three files
above, through the Claude GitHub App. The job never merges or deploys. It runs
only while the maintainer's configured Mac is on and logged in, so an update
can arrive late or not at all while that Mac is unavailable. See the source
repository's `automation/README.md`.

The source repository has no license; the package is not published to any registry.
