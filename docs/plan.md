# Plan

The order of work for the rewrite. Each milestone is one pull request in a `gh stack` on `main`, reviewable on its own, test first. Local spikes (L) run on a laptop; the Bunny spike (S1) runs on throwaway bunny.net resources that are deleted afterwards. A spike is not a pull request: its dated note under `docs/spikes/` lands in the pull request of the change that uses it. The test strategy is in `docs/testing.md`; this plan names which checks prove a milestone, not how they run.

Work stays inside this repository. Where a milestone needs deploy tooling behavior that does not exist yet, a temporary copy lives under `test/` for testing only, never in the published package, and no other repository is changed from this plan.

## Overview

| # | Milestone | Depends on | Unblocks |
| --- | --- | --- | --- |
| M0 | Repository and test setup | none | everything |
| S1.1 | Spike, Bunny: the loader (done) | M0 | L2, M2 |
| L1 | Spike, local: Astro facts (done) | none (before or during M2) | M2 |
| L2 | Spike, local: bundle and loader (done) | S1.1 | M2, M3 |
| S1 | Spike, Bunny: steps 2 to 10 and the packed script (done) | S1.1 (parallel to M1 and M2) | M3, M4, M5 |
| M1 | Request decision, caching and header rules, pure | M0 | M4, M5 |
| M2 | Astro integration and build output, parts included | M0, L1, L2 | M3 |
| M3 | The packed script | M2, L2, S1 | M3b, M4, M5 |
| M3b | Prism in on-demand routes | M3 | M7 |
| M4 | Middleware script type | M1, M3, S1 | M5, M6 |
| M5 | Standalone script type | M4 | M7 |
| M6 | Preview | M4 | M7 |
| M7 | First release | M3b, M5, M6 | reference site migration |
| Ref | Migrate the reference site (in its own repository) | M7 | none |

Server code is packed into the one script from M3 on, so there is no post-release split milestone.

## M0: repository and test setup

- **Scope:** package metadata (`astro-adapter-bunny`, ISC, peer `astro@^7.4`, Node range), dependencies `rollup` and `systemjs`, TypeScript, the test runner, lint and format, a pre-commit hook, CI. The layout of `docs/testing.md`.
- **Done when:** CI runs and passes on an empty suite; `npm ci --ignore-scripts` works.
- **Depends on:** nothing.

## L1: spike, local Astro facts

1. Islands: only prerendered pages plus one `server:defer`; log `buildOutput` in `astro:config:done`; does `astro:routes:resolved` run earlier and show the island? (decides ADR 0003's build check)
2. `staticHeaders` with `security.csp`: what `routeToHeaders` holds, how many distinct CSPs, whether `404.html` is in it, and whether `staticHeaders` can depend on `buildOutput`.
3. `build.redirects: false`: static, dynamic, external and 302 redirects; no meta-refresh file and the right status on GET and POST; is the visitor's query kept.
4. Sharp: the default service at build, absent from server output.

- **Done when:** a dated note answers each with the test app config used.
- **Done:** [2026-10-28 note](spikes/2026-10-28-l1.md).

## L2: spike, local bundle and loader

1. Rolldown ESM, then Rollup `system`: files reachable per route for `/`, `/env` and `/code`, with and without merging small chunks. Fix the per-route budget from this.
2. Search the server output for `require(` of builtins and `.wasm` imports.
3. `s.js` in Deno: a fetch that fails once, then a retry that succeeds; two concurrent imports causing one fetch.
4. SHA-256 over 0.5, 3 and 10 MB, as an order of magnitude.
5. Run the Action's `_headers` and `_redirects` parser on the test app's files.
6. Search the newest bunny CLI's README and binary for `_headers` and `_redirects`.

- **Done when:** a dated note answers each, and the per-route budget is written into ADR 0007.
- **Done:** [2026-10-28 note](spikes/2026-10-28-l2.md). The budget was later dropped with the part transport (ADR 0007).

## S1: spike, Bunny

Done. Throwaway resources, all deleted afterwards.

1. **Loader:** `import()` fails in every form; indirect `(0, eval)` and `s.js` work; SHA-256 time. [S1.1 note](spikes/2026-10-28-s1-1.md).
2. **Builtins, WebAssembly and script size:** `child_process`, `vm`, `worker_threads`, `constants` and `path/win32` break startup, bare `buffer` works, WebAssembly compiles, 7.3 MB of generated code starts and 9.4 MB does not. [S1.2 note](spikes/2026-10-28-s1-2.md) and [S1 note](spikes/2026-10-28-s1.md), step 2.
3. **Server code transport:** the Cache API, the Storage API and our own pull zone were measured and rejected; every lazy chunk is packed into the script instead (ADR 0007). [S1 note](spikes/2026-10-28-s1.md) steps 3a to 3c, [transport](spikes/2026-10-28-s1-transport.md), [packed](spikes/2026-10-28-s1-packed.md), [pack tune](spikes/2026-10-28-s1-pack-tune.md), [minify](spikes/2026-10-28-s1-minify.md).
4. **Hand-off, request facts, Storage API, caching, other** (steps 4 to 7 and 10): [S1 note](spikes/2026-10-28-s1.md).

Not run: step 8 (reserved paths answer 404 in both types) and step 9 (a storage 404 at a replica, cold `/code` after 30 minutes idle) need the adapter's script types. They move to the live checks of M4 and M5.

## M1: request decision, caching and header rules

- **Scope:** `routing.decide`, `caching.finalize`, and the pure `_headers` and `_redirects` matching (ADR 0008), with the `Site` and `Decision` types. Path safety: decode once, split on `/` and `\`, drop `.` and `..`, encode per segment (proposed). No Astro, no Bunny.
- **Done when:** unit tests cover every row of the decision table in `docs/design.md` for each `trailingSlash`, `build.format: 'file'`, a non-root `base`, the `[locale]` against `/sitemap-index.xml` case, every reserved path, every row and exception of ADR 0005, and the rule cases of ADR 0008.
- **Depends on:** M0.

## M2: Astro integration and build output

- **Scope:** `bunny(options)`, `setAdapter` fields, build output detection, islands included (ADR 0003), `staticHeaders` only with a script, forcing `build.redirects: false` for script builds, parsing `_headers` and `_redirects`, `build/bundle` emitting `dist/index.js` plus grouped parts with hashes under `dist/client/_bunny/server/`, the eager size check, the budget check, the builtin check, `requires.env` from the schema, `.bunny/build.json` (ADR 0004). The script entries are stubs that answer 501. M3 replaces the parts under `dist/client/_bunny/server/`, the part hashes and the budget check with the packed script.
- **Pull requests:** three in the stack: the `_headers` and `_redirects` parsers with the build manifest, then `build/bundle`, then the integration.
- **Done when:** the build layer of `docs/testing.md` passes for `test/app` in its four builds and every fixture; `static-only` has no script; `oversize` behaves as testing.md says; no secret value appears in the script, parts or manifest; the build logs the script type.
- **Depends on:** M0, L1, L2.

## M3: the packed script

- **Scope:** `build/bundle` assembling `dist/index.js` from `s.js`, the eager chunks and every lazy chunk brotli-compressed and base64-encoded in string literals; the Shiki wasm rewrite, skipped when the pattern is missing; stripping server files from `entryModules`; minify with Rolldown's minifier (`keepNames`, `legalComments: 'inline'`) and the source map at `dist/index.js.map`; the size check on the whole script (warn above 1 MB, fail above 7 MB); dropping `assets.reserved` from the manifest. `packed-loader` with the loader hook (`Uint8Array.fromBase64`, `DecompressionStream('brotli')`, indirect `eval`). `storage` with path safety and the once-per-isolate log; `platform` with the lazy deploy global (ADR 0007).
- **Done when:** under the local harness, `test/app`'s `/code` renders from the packed script with the same HTML as unpacked; importing the script without the deploy global does not throw and unpacks nothing; `dist/client` holds no server code; the build fails on a refused builtin and on a script above 7 MB; a build without Shiki's wasm pattern still renders.
- **Also:** drop Rollup's 32 kB merge and its guard from `build/bundle`, and check on `/code` that unmerged chunks cost no unpacking time.
- **Open, measured here:** where the packed script stops starting (expected near 7 MB of script, about 25 MB of source); a build the size of the reference site; whether a request can fail on subrequests.
- **Depends on:** M2, L2, S1.

## M3b: Prism in on-demand routes

- **Scope:** `<Prism>` in an on-demand route fails at request time, because prismjs loads its languages through a dynamic `require` the bundler cannot see. A Vite plugin makes those language loads visible to the bundler, so they become chunks like Shiki's. Its own pull request.
- **Done when:** a `test/app` route with `<Prism>` renders on demand from the packed script.
- **Depends on:** M3.

## M4: middleware script type

- **Scope:** `app`, `scripts/middleware`, the visitor path hand-off, applying `_headers` and `_redirects` to stored files. The reference site's script type, so it comes first.
- **Done when:** `test/app/app.test.ts` and `test/fixtures/routing` pass for middleware on the local harness and once on Bunny through the deploy contract of ADR 0004 (the bunny-edge-deploy Action, or a temporary copy under `test/` where it lacks behavior); among them `sitemap-index.xml` under `[locale]`, a POST passing Astro's origin check, multiple `Set-Cookie`, a cookie page never cached, `/code` rendering from the packed script, every reserved path answering 404 (S1 step 8); a storage 404 at a replica and cold `/code` after 30 minutes idle are measured (S1 step 9).
- **Depends on:** M1, M3, S1.

## M5: standalone script type

- **Scope:** `storage` file reads with conditional headers and `Content-Type` from the extension, `scripts/standalone`.
- **Done when:** the same checks as M4 pass for standalone, locally and on Bunny; a conditional GET answers 304 at the CDN.
- **Depends on:** M4.

## M6: preview

- **Scope:** `previewEntrypoint`. Decide what it runs (design open question 3); proposed: the real packed script with storage served from `dist/client`, so preview exercises the loader.
- **Done when:** `astro preview` serves `test/app` and its HTTP checks pass against it; `astro dev` works on a custom port (R-DEV-1, R-DEV-3).
- **Depends on:** M4.

## M7: first release

- **Scope:** README (options, deploy requirements, manual deploy with the prepended line, the fixed script type, `s-maxage` needs purges, `_headers` and `_redirects` semantics, env limits, why Rollup and SystemJS are dependencies, the script size limit), the contract document for manifest fields, changelog, npm provenance.
- **Done when:** a prerelease is published after the user's explicit go, and installed into a clean project from the registry.
- **Depends on:** M5, M6.

## Reference site migration

Runs in the reference site's repository, after the first release.

- **Scope:** the change listed in `docs/design.md`: import, options, `public/_headers` from its response headers module, `frame-ancestors` into Astro's CSP config, delete its adapter package, runtime shim and Shiki stub. Its maintainers review ADR 0007's security section first.
- **Done when:** the reference site's builds deploy through its own deploy tool to commit environments and pass its smoke tests and the checks in `docs/testing.md`; a rollback to the previous release still serves.
- **Depends on:** M7 (the reference site's rule: published from the official registry).

## Deploy tooling, outside this plan

Changes the deploy tool needs are listed here and made in their own track, not from this repository: the bunny-edge-deploy Action's `_headers` and `_redirects` parser has to learn `! Name` (dropped today), `:splat` and `:placeholder` (kept literally) and query conditions (read as literal paths) before static builds match script builds (L2 step 5, ADR 0008). Server code needs no deploy tool change: it ships inside the script (ADR 0007).

## Later, not planned yet

Each starts with its own spike: a Bunny Database session driver, a Bunny cache provider with tag purges, a Bunny Optimizer image service, an optional file table that skips the storage miss for catch-all routes.
