# Dependency assessment and fix record

## October 14, 2026: npm audit advisories (TOOLING-DEPENDENCY-01)

Status: **local validation complete.** Every local check listed under Validation passed on the candidate. Before merge, the pull-request CI run and a fresh independent review still have to pass. Their results are recorded outside this file.

An audit severity rating describes the package in general. It does not show that this app can be exploited in production. A clean audit later covers only advisories that are known at that time. It does not establish future security.

### Baseline audit (clean base `0feed91`)

`npm audit` reported 5 packages: 4 high and 1 moderate.

| Package (baseline) | How it is reached | Advisories | Fixed in |
|---|---|---|---|
| `source-map-js` 1.2.1 | `vite` 8.2.2 → `postcss` 8.5.28 (`^1.2.1`); `jsdom` → `css-tree` 3.2.1 (`^1.2.1`) | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q): event-loop denial of service through indexed source-map section offsets | 1.2.2 |
| `sharp` 0.35.4 | `miniflare` (direct, and through `wrangler`), pinned exactly | [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w): librsvg dependency, CVE-2026-96889 | 0.35.5 |
| `undici` 7.29.0 (nested `node_modules/miniflare/node_modules/undici`) | `miniflare`, pinned exactly. The top-level `undici` from `jsdom` was already 7.29.1. | [GHSA-3wwx-pv8p-q78v](https://github.com/advisories/GHSA-3wwx-pv8p-q78v), [GHSA-pmjh-fq2x-6v4x](https://github.com/advisories/GHSA-pmjh-fq2x-6v4x), [GHSA-r53p-7pc4-xj5r](https://github.com/advisories/GHSA-r53p-7pc4-xj5r), [GHSA-rfgv-xxqx-mfg5](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5), [GHSA-3xpg-4rpp-hhhm](https://github.com/advisories/GHSA-3xpg-4rpp-hhhm), [GHSA-2jfj-6hjv-fm6j](https://github.com/advisories/GHSA-2jfj-6hjv-fm6j), [GHSA-2gqq-gqf2-x968](https://github.com/advisories/GHSA-2gqq-gqf2-x968), [GHSA-w293-vg96-wgc3](https://github.com/advisories/GHSA-w293-vg96-wgc3), [GHSA-8436-99hf-9mmv](https://github.com/advisories/GHSA-8436-99hf-9mmv), [GHSA-rx4f-c7p8-82vq](https://github.com/advisories/GHSA-rx4f-c7p8-82vq) | 7.29.1 |
| `miniflare` 5.20260911.0-alpha | Direct dev dependency; also pinned by `wrangler` | Flagged through `sharp` and `undici` (affected range up to 5.20261006.0-alpha) | 5.20261012.0-beta |
| `wrangler` 4.131.1 | Direct dev dependency | Flagged through `miniflare` (affected range 4.102.0–4.143.0) | 4.151.0 |

### Where the flagged packages run

| Area | Flagged packages | Assessment |
|---|---|---|
| Browser runtime (`dist`, GitHub Pages) | None | Browser code imports `hls.js`, `mpg123-decoder` and relative app modules only. No flagged package is imported by `src/`, `lib/` or `worker/`. |
| Browser build (Node, `npm run build`) | `source-map-js` (through Vite → PostCSS) | Build-time only and not shipped in `dist`. Triggering it would need a hostile indexed source map, and the CSS inputs come from this repository. Vite is listed under `dependencies`, so the baseline `npm audit --omit=dev` counted this build-time path as a production dependency. With 1.2.2, the final `--omit=dev` audit reports 0. |
| Local tests (`npm test`) | `source-map-js` (through jsdom → css-tree) | Test-only. |
| Local Worker tooling (`npm run test:worker`, `worker:dev`, `worker:dry-run`, `worker:types`) | `miniflare`, `sharp`, `undici`, `wrangler` | `scripts/test-worker.mjs` imports `Miniflare` and runs `wrangler deploy --dry-run`. During this integration test, Miniflare's `undici` talks only to localhost and fixture handlers. Other `wrangler dev` use can reach real upstreams. `sharp` backs Miniflare's Images emulation, and `wrangler.jsonc` declares no images binding. |
| Deployed Worker (Cloudflare) | None | `worker/index.mjs` is bundled by Wrangler/esbuild and runs on Cloudflare's runtime. Wrangler is the deploy tool and is not part of the deployed code. |

### Fix

- `package.json`: exact dev pins `wrangler` 4.131.1 → **4.151.0** and `miniflare` 5.20260911.0-alpha → **5.20261012.0-beta**. Wrangler 4.151.0 pins exactly this Miniflare, so the direct pin keeps a single Miniflare and workerd. That way the Worker test harness and `wrangler dev` use the same engine.
- Miniflare 5.20261012.0-beta pins `sharp` 0.35.5 and `undici` 7.29.1. The nested `undici` therefore dedupes to the existing top-level 7.29.1.
- `source-map-js` 1.2.1 → **1.2.2** in the lockfile only, within the existing `^1.2.1` ranges of `postcss` and `css-tree`. `vite`, `postcss`, `jsdom` and `css-tree` stay the same.
- There are no `overrides`, no `npm audit fix --force`, no major downgrade and no unrelated upgrades.

Prerelease note: Miniflare 5.20261012.0-beta is a prerelease (npm `beta` tag; npm `latest` is still 4.x). It is the version that stable Wrangler 4.151.0 pins, and the baseline was already on a Miniflare 5 alpha. Wrangler and Miniflare both require Node `>=22.0.0`. The repository already requires Node 22.12+.

Other changes brought in by the new Wrangler/Miniflare pins (all in tooling):

- `workerd` 1.20260911.1 → 1.20261012.1, plus its platform packages. This is the engine for local tests and `wrangler dev` only. The production Worker's `compatibility_date` (2026-09-12) is unchanged.
- `esbuild` 0.28.1 → 0.28.2 and `@cloudflare/unenv-preset` 2.16.1 → 2.16.2. These build the Worker bundle, so they take effect at the **next** authorized Worker deploy. This change does not redeploy the Worker. The candidate dry-run bundle for this Worker is byte-identical to the baseline (see Validation).
- `sharp` and the `@img/sharp-*` platform packages 0.35.4 → 0.35.5. The `@img/sharp-libvips-*` native packages go 1.3.3 → 1.3.4, which is what sharp 0.35.5 itself pins.

The generated lock changes only these entries, plus the root `devDependencies` and Wrangler's own dependency/peer metadata. No `@cloudflare/workers-types` package was added. The nested `node_modules/miniflare/node_modules/undici` entry is removed, so Miniflare now uses the top-level `undici` 7.29.1. Linux x64 entries are present for `workerd`, `sharp` and `sharp-libvips`. There is no `overrides` block. `vite`, `postcss`, `jsdom`, `css-tree`, `hls.js` and `mpg123-decoder` are unchanged.

### Test harness change required by Miniflare 5.20261012.0-beta

With the new Miniflare, `npm run test:worker` failed before any check ran:

```
MiniflareCoreError [ERR_VALIDATION]: Unexpected options passed to `new Miniflare()` constructor:
✖ Unrecognized key: "type"  → at workers[0..3].config
```

Miniflare's per-worker `config` schema (`MiniflareWorkerConfigSchema` in the installed `miniflare/dist/src/index.d.ts`) no longer has a `type` key and rejects unknown keys. `scripts/test-worker.mjs` passed `type: 'worker'` in each of its four worker configs (`gateway`, `cancel-probe`, `schedule-probe`, `reader-probe`). Under the beta, every entry in `workers` is a worker, so the field no longer carries any meaning.

The only change is removing those four `type: 'worker'` keys. Nothing else in the harness changes:

- fixture bindings, including the KV id;
- the `fetcher` and `node-handler` outbound fixtures;
- the compatibility date;
- the modules loaded;
- every assertion and check name.

No assertion is weakened. The other options the harness uses still match the installed schema: `manifest`, `env` text/kv bindings, `dev.outboundService` `fetcher`/`node-handler`, and `ready`/`getWorker`/`getKVNamespace`/`dispose`. After the change, `npm run test:worker` passed under workerd 1.20261012.1. It ran the same 20 checks as the baseline run, and no assertion was changed or retried. The old alpha's schema was not inspected, because only the beta is installed now.

### Alternatives rejected

- **Audit's suggested `miniflare` 4.20260616.0.** This is a major downgrade from Miniflare 5 and would change the test harness API. The current stable 4.x (4.20260730.0) still pins vulnerable `sharp` 0.35.2 and `undici` 7.28.0.
- **`overrides` for `sharp`/`undici` under the old alpha.** This contradicts Miniflare's exact pins, creates an untested combination and leaves the Wrangler advisory open.
- **Moving Vite to `devDependencies`.** This is unrelated classification churn and does not fix the advisory.

### Effect of merging

- The Pages workflow republishes the browser app from `main`. The built main JS differs from the baseline only in the build revision, and the CSS is byte-identical.
- There is no Worker redeploy. The deployed Worker is unchanged until a separately authorized deploy. The new tooling produces a byte-identical bundle for the current Worker source.
- Worker config, bindings, routes, compatibility date, catalog, secrets, application source and tests are not changed. The one exception is the four-key harness change described above.

### Validation

Commands, using Node 22.12+ and starting from a clean `node_modules`. Raw output is kept outside the repository.

| Check | Command | Result |
|---|---|---|
| Lock generation | `npm install`, then `npm update source-map-js`; `package.json` must stay byte-identical | PASS: manifest unchanged; lock changes limited to the closure listed under Fix |
| Lock diff | Only the packages listed under Fix change; linux-x64 entries exist for `workerd` and `sharp`; no `overrides` | PASS |
| Reproducible install | `npm ci` with the lock hash unchanged before/after | PASS: lock hash unchanged |
| Version tree | `npm ls wrangler miniflare sharp undici source-map-js workerd esbuild --all` | Recorded |
| Audit | `npm audit` and `npm audit --omit=dev` | PASS: 0 vulnerabilities in both |
| Unit tests | `npm test` | PASS: 546 tests |
| Production build and private checks | `REQUIRE_GATEWAY=true VITE_GATEWAY_ORIGIN=<production gateway> npm run build`; `npm run check:private` | PASS |
| Worker integration (fixture upstreams, includes a dry-run) | `npm run test:worker` | First run failed on the Miniflare schema change (see above). After the four-key harness change: PASS, workerd 1.20261012.1, the same 20 checks as the baseline. |
| Worker dry-run, no deploy | `npm run worker:dry-run`; `npx wrangler deploy --dry-run --env preview`; `npx wrangler deploy --dry-run --env local` | PASS (all three) |
| Bundle comparison | Baseline vs. candidate dry-run `index.js`; baseline vs. candidate `dist` JS/CSS, normalizing only the build revision | PASS: Worker bundle byte-identical (SHA-256 `52ca10d6…7371`), so esbuild 0.28.2/unenv-preset 2.16.2 produce the same deploy bundle for this Worker; browser main JS identical apart from the build revision; CSS byte-identical |
| CI | Pull-request run of `pages.yml` on ubuntu-latest, Node 22, for the exact candidate (pull requests do not deploy) | Merge gate; recorded outside this file |

The local checks ran on the coordinator's macOS machine. The CI run must repeat `npm ci`, `npm test`, `npm run test:worker` and `npm run build` on Linux Node 22 for the frozen candidate before merge.

### Limits

- All checks use local workerd with fixture upstreams and no audio playback. They do not cover the deployed cache, platform CPU, browser HLS, account entitlements, or phone/TV/live behavior.
- Existing device, live and native gates in `BACKLOG.md` are unchanged.
- The audit reflects the advisory database on October 14, 2026.
