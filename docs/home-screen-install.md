# Home Screen Install (vendored)

`src/vendor/home-screen-install/` holds a vendored copy of the ES module from
[michaeltorbert/home-screen-install](https://github.com/michaeltorbert/home-screen-install).
It sits outside `public/`, so Vite includes it only once client code imports it.

**Homecall does not load it yet.** No source file imports it, so the build
output, audio, sessions and settings are unchanged. Adding the button is
tracked in #52, which stays open until Homecall is adopted and verified on
iPhone and iPad.

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
