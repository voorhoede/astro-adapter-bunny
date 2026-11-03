# Plan

The order of work for the rewrite. Each milestone is one pull request in a `gh stack` on `main`, reviewable on its own, test first. Platform checks run on throwaway bunny.net resources that are deleted afterwards, within a budget stated before they start. The test strategy is in `docs/testing.md`; this plan names which checks prove a milestone, not how they run.

Work stays inside this repository. Where a milestone needs deploy tooling behavior that does not exist yet, a temporary copy lives under `test/` for testing only, never in the published package, and no other repository is changed from this plan.

## Overview

| # | Milestone | Depends on | Unblocks |
| --- | --- | --- | --- |
| M0 | Repository and test setup (done) | none | everything |
| M1 | Request decision, caching and header rules, pure (done) | M0 | M4, M5 |
| M2 | Astro integration and build output (done) | M0 | M3 |
| M3 | One plain script | M2 | M3c, M4, M5 |
| M3b | Prism in on-demand routes (deferred) | M3 | none |
| M3c | Default cache provider and `_headers` Cache-Control | M3 | M7 |
| M4 | Middleware script type | M1, M3 | M5, M6 |
| M5 | Standalone script type | M4 | M7 |
| M6 | Preview | M4 | M7 |
| M7 | First release | M3c, M5, M6 | reference site migration |
| Ref | Migrate the reference site (in its own repository) | M7 | none |

## M0: repository and test setup (done)

Package metadata (`astro-adapter-bunny`, ISC, peer `astro@^7.4`, Node range), TypeScript, the test runner, lint and format, a pre-commit hook, CI with `npm ci --ignore-scripts`.

## M1: request decision, caching and header rules (done)

`routing.decide`, `caching.finalize`, and the pure `_headers` and `_redirects` matching, with the `Site` and `Decision` types. Unit tests cover every row of the decision table in `docs/design.md`, including prerendered pages mapped by their source name for `build.format: 'preserve'`.

## M2: Astro integration and build output (done)

`bunny(options)`, `setAdapter` fields, build output detection with islands, `staticHeaders` only with a script, `build.redirects: false` for script builds, the `_headers` and `_redirects` parsers, `requires.env` from the schema, `.bunny/build.json` (ADR 0004). M3 replaces its server output step.

## M3: one plain script

- **Scope:** `build/bundle` runs one Rolldown pass over `dist/server` with code splitting off and writes `dist/index.js`. Astro's own build cannot do this: Rolldown refuses `codeSplitting: false` with several inputs, and Astro's server build has several. No minify, no source map. Rollup and SystemJS leave the dependencies, and nothing is written under `dist/client` for server code. Until M4 the script hands every request to Astro's `fetch` through `Bunny.v1.serve`. The `/code` page leaves `test/app`, since one `<Code>` block puts the script above 10 MB.
- **Checks kept from M2:** refused builtins (`child_process`, `vm`, `worker_threads`, `constants`, `path/win32`), a package import Astro left unbundled fails the build, bundler warnings go through Astro's logger.
- **Size check:** on the whole script, warn above 7 MB and fail above 10 MB. The error names the five largest packages in the bundle.
- **Test setup:** `test/harness` runs a built script under Deno with a `Bunny` stub; CI installs Deno 2.7.12.
- **Done when (tests first):** the script, copied alone into an empty directory, loads without the deploy global and registers a handler; it contains no `import()` expression; `/common`, which requires a Node builtin from a CommonJS module, renders from it with the same HTML as `dist/server/entry.mjs`; `dist/client` holds no server code; the build fails on a refused builtin and on an unbundled package; a fixture with one `<Code>` block fails the build above 10 MB with Shiki among the named packages; the build warns above 7 MB; the manifest's `script.bytes` is the file size.
- **Decided here:** a CommonJS `require` of a builtin, which Rolldown emits as `createRequire(import.meta.url)`, works in the plain script, since `import.meta.url` is the script's own file. Verified under Deno and on bunny.net on 2026-11-03 (a standalone script answered `/common` with 200).
- **Depends on:** M2.

## M3b: Prism in on-demand routes (deferred)

`<Prism>` and Markdown with `syntaxHighlight: 'prism'` fail at request time in an on-demand route, because prismjs loads its languages by a path computed at runtime, which a bundler cannot see. Prerendered pages are highlighted at build and are not affected. The official bunny.net adapter does not handle this either, so the gap stays until a project needs it. When picked up: a Vite plugin replaces Prism's language loader with one that imports every language file.

## M3c: default cache provider and `_headers` Cache-Control

- **Scope:** a bunny.net CDN cache provider registered by default when the project has none (ADR 0005), `BUNNY_API_KEY` as an optional secret in `requires.env`, and `_headers` setting `Cache-Control` on stored files (ADR 0008).
- **Decided from measurements on 2026-10-30 and 2026-11-03:** the provider emits `public, s-maxage` and never `max-age=0`; `invalidate()` purges by URL and refuses tags, since tag purges did not take effect within 5 minutes while URL and zone purges did within 30 s.
- **Done when:** `routeRules` on an on-demand `test/app` route give the expected header from the script and are cached at the CDN on bunny.net; `invalidate()` calls the purge API with the right URL against a fake API, and fails clearly for tags, without the key and without `site`; `_headers` Cache-Control lands on a stored file.
- **Later:** `invalidate()` by tag, if bunny.net makes tag purges work for script responses.
- **Depends on:** M3.

## M4: middleware script type

- **Scope:** `app`, `storage` with path safety and a once-per-isolate log, `platform` with the lazy deploy global, `scripts/middleware`, the visitor path hand-off, applying `_headers` and `_redirects` to stored files. The reference site's script type, so it comes first.
- **Done when:** `test/app/app.test.ts` and `test/fixtures/routing` pass for middleware on the local harness and once on bunny.net through the deploy contract of ADR 0004 (the bunny-edge-deploy Action, or a temporary copy under `test/` where it lacks behavior); among them `sitemap-index.xml` under `[locale]`, a POST passing Astro's origin check, multiple `Set-Cookie`, a cookie page never cached, every reserved path answering 404. A storage 404 at a replica and a cold request after 30 minutes idle are measured.
- **Depends on:** M1, M3.

## M5: standalone script type

- **Scope:** `storage` file reads with conditional headers and `Content-Type` from the extension, `scripts/standalone`.
- **Done when:** the same checks as M4 pass for standalone, locally and on bunny.net; a conditional GET answers 304 at the CDN.
- **Depends on:** M4.

## M6: preview

- **Scope:** `previewEntrypoint`. Proposed: the real script with storage served from `dist/client`.
- **Done when:** `astro preview` serves `test/app` and its HTTP checks pass against it; `astro dev` works on a custom port (R-DEV-1, R-DEV-3).
- **Depends on:** M4.

## M7: first release

- **Scope:** README (options, deploy requirements, manual deploy with the prepended line, the fixed script type, `s-maxage` needs purges, `_headers` and `_redirects` semantics, env limits, the script size limits, Shiki and Prism as known limits), the contract document for manifest fields, changelog, npm provenance.
- **Done when:** a prerelease is published after the user's explicit go, and installed into a clean project from the registry.
- **Depends on:** M3c, M5, M6.

## Reference site migration

Runs in the reference site's repository, after the first release.

- **Scope:** the change listed in `docs/design.md`: import, options, `public/_headers` from its response headers module, `frame-ancestors` into Astro's CSP config, delete its adapter package and runtime shim. Its Shiki alias stays.
- **Done when:** the reference site's builds deploy through its own deploy tool to commit environments and pass its smoke tests and the checks in `docs/testing.md`; a rollback to the previous release still serves.
- **Depends on:** M7 (the reference site's rule: published from the official registry).

## Deploy tooling, outside this plan

Changes the deploy tool needs are listed here and made in their own track, not from this repository: the bunny-edge-deploy Action's `_headers` and `_redirects` parser has to learn `! Name` (dropped today), `:splat` and `:placeholder` (kept literally) and query conditions (read as literal paths) before static builds match script builds (ADR 0008). The deploy tool sets `BUNNY_API_KEY` as a script secret, and purges only after a successful publish or rollback, in the order upload, publish, smoke test, purge (ADR 0004).

## Later, not planned yet

- Where between 7 and 10 MB a plain script stops starting on bunny.net, measured with real Astro output.
- A Shiki stub option for projects that never highlight code at runtime.
- A Bunny Database session driver, a Bunny Optimizer image service, Astro's per-page `Cache-Control` on prerendered pages and `routeRules` headers in `_headers` for static builds, an optional file table that skips the storage miss for catch-all routes.
