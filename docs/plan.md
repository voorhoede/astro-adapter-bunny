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
| M3c | Default cache provider and `_headers` Cache-Control | M3 | none |
| M4 | Middleware script type | M1, M3 | M5, M6 |
| M5 | Standalone script type | M4 | none |
| M6 | Preview | M4 | none |
| Ref | Migrate the reference site (in its own repository) | M3c, M5, M6 | none |

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

- **Scope:** `runtime/platform` (visitor URL from `cdn-host`, the deploy global read lazily), `runtime/storage` (Storage API reads inside the deploy folder, used by standalone in M5), `runtime/middleware` (`decide` in `onOriginRequest`, the visitor path handed to `onOriginResponse` as `__bunny_path`, `finalize` on every exit, error pages fetched through the site's own pull zone), `requires.env` without storage variables for middleware, `scripts/middleware` through `@bunny.net/edgescript-sdk`, the site data written into the script by `build/bundle`, the `script` option choosing the entry, and `staticCacheControl`.
- **Done when:** `test/fixtures/routing` passes for middleware on the local harness, which stands in for the pull zone; on bunny.net once, with a storage zone, the middleware script and a pull zone: `sitemap-index.xml` written after the adapter under `[locale]`, `[locale]` rendering, a prerendered page with `_headers`, a `_redirects` rule, a POST through Astro's origin check, two `Set-Cookie` on a private page, the 404 page for an unknown path and for every reserved path.
- **Verified on bunny.net on 2026-11-03:** every item above answered as expected, and again end to end after the fix below, error pages through the CDN included.
- **Found on bunny.net and fixed:** storage sends `Cache-Control: max-age=25600000` to `onOriginResponse` through the CDN (measured on 2026-11-03), which `finalize` kept as if `_headers` had set it. It now drops storage's value for stored files, so only `_headers` or the defaults decide.
- **Later:** a clear log line naming a missing required variable; a deploy through the bunny-edge-deploy Action.
- **Depends on:** M1, M3.

## M5: standalone script type

- **Scope:** `runtime/handlers` shared by both script types, with `serve` for standalone; `runtime/storage` reading every stored file through the Storage API, with the type taken from the extension where the API sends `application/octet-stream`; `scripts/standalone` through `@bunny.net/edgescript-sdk`.
- **Done when:** `test/fixtures/routing` passes for both script types on the local harness, and on bunny.net once with a storage zone and a standalone script; a conditional GET answers 304 at the CDN.
- **Verified on bunny.net on 2026-11-03:** every fixture path answered as expected, `site.webmanifest` came as `application/manifest+json`, and a GET with `If-None-Match` on an `_astro` file answered 304.
- **Depends on:** M4.

## M6: preview

- **Scope:** `previewEntrypoint`: `astro preview` loads the real `dist/index.js` with a `Bunny` stub and a deploy line, behind `preview/pull-zone`, which stands in for the pull zone as measured and serves storage from `dist/client`. The Deno test harness uses the same pull zone stand-in. `visitorUrl` takes the scheme from the last `x-forwarded-proto` value, so a POST passes Astro's origin check over http in preview.
- **Done when:** `astro preview` serves `test/app` in both script types (stored pages, on-demand pages, cookies, a server secret from the environment), and `astro dev` serves it on a given port.
- **Static builds:** without a script, preview resolves a path to its page in `dist/client` (`/about` to `about/index.html` or `about.html`) and answers `404.html` with status 404.
- **Depends on:** M4.

## Reference site migration

Runs in the reference site's repository.

- **Scope:** the change listed in `docs/design.md`: import, options, `public/_headers` from its response headers module, `frame-ancestors` into Astro's CSP config, delete its adapter package and runtime shim. Its Shiki alias stays.
- **Done when:** the reference site's builds deploy through its own deploy tool to commit environments and pass its smoke tests and the checks in `docs/testing.md`; a rollback to the previous release still serves.
- **Depends on:** M3c, M5, M6.

## Deploy tooling, outside this plan

Changes the deploy tool needs are listed here and made in their own track, not from this repository: the bunny-edge-deploy Action's `_headers` and `_redirects` parser has to learn `! Name` (dropped today), `:splat` and `:placeholder` (kept literally) and query conditions (read as literal paths) before static builds match script builds (ADR 0008). The deploy tool sets `BUNNY_API_KEY` as a script secret, and purges only after a successful publish or rollback, in the order upload, publish, smoke test, purge (ADR 0004).

## Later, not planned yet

- A build step to JavaScript, a README, and publishing to npm.

- Where between 7 and 10 MB a plain script stops starting on bunny.net, measured with real Astro output.
- A Shiki stub option for projects that never highlight code at runtime.
- A Bunny Database session driver, a Bunny Optimizer image service, Astro's per-page `Cache-Control` on prerendered pages and `routeRules` headers in `_headers` for static builds, an optional file table that skips the storage miss for catch-all routes.
