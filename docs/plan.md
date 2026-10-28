# Plan

The order of work for the rewrite. Each milestone is one pull request in a `gh stack` on `main`, reviewable on its own, test first. Local spikes (L) run on a laptop; the Bunny spike (S1) runs on throwaway bunny.net resources that are deleted afterwards. A spike is not a pull request: its dated note under `docs/spikes/` lands in the pull request of the change that uses it. The test strategy is in `docs/testing.md`; this plan names which checks prove a milestone, not how they run.

Work stays inside this repository. Where a milestone needs deploy tooling behavior that does not exist yet, a temporary copy lives under `test/` for testing only, never in the published package, and no other repository is changed from this plan.

## Overview

| # | Milestone | Depends on | Unblocks |
| --- | --- | --- | --- |
| M0 | Repository and test setup | none | everything |
| S1.1 | Spike, Bunny: the loader | M0 | L2, M2 |
| L1 | Spike, local: Astro facts | none (before or during M2) | M2 |
| L2 | Spike, local: bundle and loader | S1.1 | M2, M3 |
| S1 | Spike, Bunny: steps 2 to 10 | S1.1 (parallel to M1 and M2) | M3, M4, M5 |
| M1 | Request decision, caching and header rules, pure | M0 | M4, M5 |
| M2 | Astro integration and build output, parts included | M0, L1, L2 | M3 |
| M3 | Server parts at runtime | M2, L2, S1 | M4, M5 |
| M4 | Middleware script type | M1, M3, S1 | M5, M6 |
| M5 | Standalone script type | M4 | M7 |
| M6 | Preview | M4 | M7 |
| M7 | First release | M5, M6 | reference site migration |
| Ref | Migrate the reference site (in its own repository) | M7 | none |

Server code is split from the first build on, so there is no post-release split milestone.

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

## L2: spike, local bundle and loader

1. Rolldown ESM, then Rollup `system`: files reachable per route for `/`, `/env` and `/code`, with and without merging small chunks. Fix the per-route budget from this.
2. Search the server output for `require(` of builtins and `.wasm` imports.
3. `s.js` in Deno: a fetch that fails once, then a retry that succeeds; two concurrent imports causing one fetch.
4. SHA-256 over 0.5, 3 and 10 MB, as an order of magnitude.
5. Run the Action's `_headers` and `_redirects` parser on the test app's files.
6. Search the newest bunny CLI's README and binary for `_headers` and `_redirects`.

- **Done when:** a dated note answers each, and the per-route budget is written into ADR 0007.

## S1: spike, Bunny

One throwaway zone pair (middleware and standalone). Step 1 (S1.1) runs right after M0 and before L2 and M2, because it can break the split decision; the other steps follow in this order:

1. **Loader:** does `import()` still fail in every form; does indirect `(0, eval)` run; does `s.js` load a chain of `System.register` parts through its fetch hook from the Storage API; SHA-256 time.
2. **Builtins:** `constants`, `path/win32`, bare `buffer`.
3. **Part transport** (ADR 0007), in this order:
   - 3a. Cache API in both script types, from three regions: hit and miss latency, how long a part survives before eviction, per PoP or per region.
   - 3b. The decisive check for the alternative: does an edge rule block a request without the secret header even when the object is already in the CDN cache?
   - 3c. One module against split, cold, from the same three regions.
   - Decision rule: keep the Cache API if it is fast enough and parts stay cached long enough; otherwise switch to the pull zone alternative, only if 3b passes. Also: the part path requested by a visitor answers 404 in both types.
4. **Hand-off:** a query parameter and a header on the rewritten request, what `onOriginResponse` sees; storage ignores the query; the cache key is the visitor URL; two visitor paths mapping to one key share no cache entry.
5. **Request facts:** `request.url` in standalone; are `Range` and `If-*` stripped and HEAD turned into GET before a script origin; does a `Response` stream.
6. **Storage API:** `Content-Type`, `ETag`, `Last-Modified` per extension (`.css`, `.js`, `.svg`, `.webmanifest`, `.html`, none); `Range` and `If-None-Match`.
7. **Caching:** `Set-Cookie` with `public, max-age`; `Vary: cookie` with `s-maxage`; does Bunny read `CDN-Cache-Control`.
8. **Reserved paths:** `/_bunny/...`, `/_headers`, `/_redirects`, `/deploys/...` answer 404 in both types.
9. **Cost:** a storage 404 at a replica (ADR 0002); cold first byte of `/code` from five PoPs after 30 minutes idle.
10. **Other:** changing `ScriptType` through the API; which zone settings `bunny scripts create --type middleware` makes; does the SDK's `servePullZone` match production.

- **Done when:** a dated note per step, with the script used, and the zones are deleted. If step 1 fails, stop and decide the loader fallback before L2 and M2 start.

## M1: request decision, caching and header rules

- **Scope:** `routing.decide`, `caching.finalize`, and the pure `_headers` and `_redirects` matching (ADR 0008), with the `Site` and `Decision` types. Path safety: decode once, split on `/` and `\`, drop `.` and `..`, encode per segment (proposed). No Astro, no Bunny.
- **Done when:** unit tests cover every row of the decision table in `docs/design.md` for each `trailingSlash`, `build.format: 'file'`, a non-root `base`, the `[locale]` against `/sitemap-index.xml` case, every reserved path, every row and exception of ADR 0005, and the rule cases of ADR 0008.
- **Depends on:** M0.

## M2: Astro integration and build output

- **Scope:** `bunny(options)`, `setAdapter` fields, build output detection and the island check (ADR 0003), `staticHeaders` only with a script, forcing `build.redirects: false` for script builds, parsing `_headers` and `_redirects`, `build/bundle` emitting `dist/index.js` plus grouped parts with hashes under `dist/client/_bunny/server/`, the eager size check, the budget check, the builtin check, `requires.env` from the schema, `.bunny/build.json` (ADR 0004). The script entries are stubs that answer 501.
- **Done when:** the build layer of `docs/testing.md` passes for `test/app` in its four builds and every fixture; `static-only` has no script; `oversize` behaves as testing.md says; no secret value appears in the script, parts or manifest; the build logs the script type.
- **Depends on:** M0, L1, L2.

## M3: server parts at runtime

- **Scope:** `server-parts` wrapping `s.js` with the part transport S1 chose (proposed: Cache API, `storage` on a miss), the hash check, retry after failure, one fetch for concurrent imports; `storage` with path safety and the once-per-isolate log; `platform` with the lazy deploy global.
- **Done when:** under the local harness, `test/app`'s `/code` renders from parts; a failed part fetch recovers on the next request; concurrent first requests fetch a part once; a tampered part answers 500; importing the script without the deploy global does not throw; a route stays within the budget.
- **Depends on:** M2, L2, S1.

## M4: middleware script type

- **Scope:** `app`, `scripts/middleware`, the visitor path hand-off, applying `_headers` and `_redirects` to stored files. The reference site's script type, so it comes first.
- **Done when:** `test/app/app.test.ts` and `test/fixtures/routing` pass for middleware on the local harness and once on Bunny through the deploy contract of ADR 0004 (the bunny-edge-deploy Action, or a temporary copy under `test/` where it lacks behavior); among them `sitemap-index.xml` under `[locale]`, a POST passing Astro's origin check, multiple `Set-Cookie`, a cookie page never cached, `/code` rendering from parts, every reserved path answering 404.
- **Depends on:** M1, M3, S1.

## M5: standalone script type

- **Scope:** `storage` file reads with conditional headers and `Content-Type` from the extension, `scripts/standalone`.
- **Done when:** the same checks as M4 pass for standalone, locally and on Bunny; a conditional GET answers 304 at the CDN.
- **Depends on:** M4.

## M6: preview

- **Scope:** `previewEntrypoint`. Decide what it runs (design open question 3); proposed: the real eager script and parts with storage served from `dist/client`, so preview exercises the loader.
- **Done when:** `astro preview` serves `test/app` and its HTTP checks pass against it; `astro dev` works on a custom port (R-DEV-1, R-DEV-3).
- **Depends on:** M4.

## M7: first release

- **Scope:** README (options, deploy requirements, manual deploy with the prepended line, the fixed script type, `s-maxage` needs purges, `_headers` and `_redirects` semantics, env limits, why Rollup and SystemJS are dependencies), the contract document for manifest fields, changelog, npm provenance.
- **Done when:** a prerelease is published after the user's explicit go, and installed into a clean project from the registry.
- **Depends on:** M5, M6.

## Reference site migration

Runs in the reference site's repository, after the first release.

- **Scope:** the change listed in `docs/design.md`: import, options, `public/_headers` from its response headers module, `frame-ancestors` into Astro's CSP config, delete its adapter package, runtime shim and Shiki stub. Its maintainers review ADR 0007's security section first.
- **Done when:** the reference site's builds deploy through its own deploy tool to commit environments and pass its smoke tests and the checks in `docs/testing.md`; a rollback to the previous release still serves.
- **Depends on:** M7 (the reference site's rule: published from the official registry).

## Deploy tooling, outside this plan

Changes the deploy tool needs are listed here and made in their own track, not from this repository: the smoke test must not pick a file under `_bunny/server/`, and if S1 picks the pull zone alternative for parts, the deploy tool creates its edge rule and shared secret.

## Later, not planned yet

Each starts with its own spike: a Bunny Database session driver, a Bunny cache provider with tag purges, a Bunny Optimizer image service, an optional file table that skips the storage miss for catch-all routes.
