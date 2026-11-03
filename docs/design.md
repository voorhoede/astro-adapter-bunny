# Design

How `astro-adapter-bunny` is built: an Astro 7 adapter for bunny.net Edge Scripting, written from scratch. Decisions are recorded in `docs/adr/`, the order of work in `docs/plan.md`, the test strategy in `docs/testing.md`. Each ADR carries its own status; a section here marked **(accepted)** follows a user decision, everything else is proposed.

Claims that are expected but not checked carry **[E]**, and open questions **[open]**. Everything unmarked was verified in an Astro 7.4.2 build or on bunny.net between 2026-10-16 and 2026-10-30.

## Goals

- Replace the reference site's vendored adapter with an import and options change, plus moving its header baseline into `public/_headers` (requirements: Must rows).
- Both script types, **standalone** and **middleware**, with identical routing, headers and caching.
- One pure function decides what a request becomes, so routing is tested without a runtime.
- A file in storage wins over a dynamic on-demand route, including files written by integrations after the adapter (R-ROUTE-2).
- No response ever leaves without `Cache-Control` (bunny caches it 30 days otherwise).
- Far fewer options than a typical adapter: two.
- Nothing is fetched from third parties at runtime; the package works with `npm ci --ignore-scripts` (G-10, the reference site's rules).

## Non-goals for v1

- Deploying. Zone names, environments, purges, rollback and retention belong to the deploy tool. The adapter only declares what its runtime needs.
- Running before the cache (`onClientRequest`). It costs a script run per cache hit.
- A default session driver and a Bunny Optimizer image service (ADR 0006).
- `i18n.domains` (marked unsupported until forwarded host handling is verified).

## The core idea, critiqued

The proposal: one pure function per request returns a decision (render, redirect, stored file, miss), and each script type is a thin translation of that decision.

**What holds.** The two script types differ only in how they are entered (`serve` versus `registerMiddlewares`) and how a stored file is reached (rewrite to the origin versus a Storage API read). Everything else (base, trailing slash, `build.format`, method rules, which routes may claim a path, not-found order, `_redirects`) is the same and is pure.

**What does not hold, and the fix.** A pure function cannot know whether a file exists. A build-time file list misses files written after the adapter's hook (the reference site's bug), and asking storage inside the function makes it impure. So the decision is data that contains the miss: a stored-file decision carries what to do when the file is absent.

```ts
type Decision =
  | { type: "render" }
  | { type: "redirect"; status: number; location: string }
  | { type: "file"; key: string; status?: 404; otherwise: Decision };
```

Each script type interprets `file` with its own I/O and, on a 404 from storage, interprets `otherwise`. A catch-all route never gets a path before storage has said it has no file there (ADR 0002).

**What the function does not do.** Route matching. `decide` never calls `app.match()`: the match comes in as a function argument. At runtime `app` backs it with `app.match(request, true)`: without the second argument Astro treats redirects as prerendered and answers them with 404 (measured in an Astro 7.4.2 build); in unit tests a table backs it, so collisions such as `[locale]` against `/sitemap-index.xml` are unit tests with no Astro build.

## Module map

Organized by domain, named as Astro and bunny.net name things.

| Module | Responsibility | Interface (sketch) | Hides |
| --- | --- | --- | --- |
| `routing` | What a request becomes | `decide(request, site, match): Decision` | `base`, `trailingSlash`, `build.format` to storage key, `build.assets` prefix, method rules, reserved paths, `_redirects` rules, not-found order |
| `caching` | Headers on every response leaving the script | `finalize(response, origin: "rendered" \| "stored" \| "adapter", headersFor?): Response` | `Cache-Control` defaults, immutable assets, the `Set-Cookie` and `Vary` rule, applying `_headers` to stored files through a lookup function, never overwriting |
| `app` | Astro's `App` in this isolate | `match(url)`, `render(request, kind)` | `createApp()` once, `app.match(request, true)` so redirect routes match, `setGetEnv`, `clientAddress` from `x-real-ip`, `waitUntil`, cookie headers, error pages read through `storage` |
| `platform` | Every bunny.net global | `deploy()`, `env(name)`, `waitUntil(p)`, `visitorUrl(request)` | `globalThis.__BUNNY_DEPLOY__` read lazily on first use, `Bunny.v1`, `Deno.env`, rebuilding the URL from `cdn-host` and `https` |
| `storage` | Read one file of this deploy through the Storage API | `readFile(key, request): Promise<Response \| undefined>` | Storage API host, `AccessKey`, deploy prefix, path safety, one place that builds storage URLs, conditional header passthrough, `Content-Type` from the extension, a 401 or 403 logged once per isolate |
| `scripts/middleware` | Middleware entry | none; registers `onOriginRequest` and `onOriginResponse` | Carrying the visitor path between hooks, rewriting to the origin, catching every throw |
| `scripts/standalone` | Standalone entry | none; calls `serve` | Calling `storage`, catching every throw |
| `build` | The Astro integration | `bunny(options?): AstroIntegration` | `setAdapter` fields, build output detection from the server entry, virtual module, forced config (`build.redirects: false`, `vite.ssr.noExternal`, the Sharp split of ADR 0006), parsing `_headers` and `_redirects`, Astro redirects appended to `_redirects` in static builds, `requires.env` from the env schema, `.bunny/build.json` |
| `build/bundle` | Server code to one script | `bundle({ dir, entry, logger }): Promise<Script>` | One Rolldown pass over Astro's server output with code splitting off, the builtin and unbundled package checks, the size check with the five largest packages, bundler warnings through Astro's logger |
| `preview` | `astro preview` | Astro's `previewEntrypoint` contract | A local Node server running the built script against `dist/client` |

Notes:

- `routing` and `caching` are pure and import nothing from Astro or bunny.net. `caching` gets `_headers` as a lookup function; the runtime never parses a file.
- `platform` is the only module that reads a global. Tests replace it.
- `storage` is used by both script types. Only `build/bundle` knows how server code becomes one file (ADR 0007).

## Request flow

### Decision table (`routing`)

Input: method, the visitor's path and query, the site facts from the build, and `match`. Rows are checked in order; the first that applies wins.

| # | Request | Decision |
| --- | --- | --- |
| 1 | Path outside `base` | `file 404.html (404)`, otherwise `render` |
| 2 | Path under `build.assets` (`/_astro/`) | `file`, otherwise not found (never rendered) |
| 3 | Reserved path: `/_bunny/`, `/_headers`, `/_redirects` | not found |
| 4 | Not GET or HEAD | `render` (bodies never go to storage) |
| 5 | Matches an on-demand route with a fixed pathname | `render` |
| 6 | Matches a redirect route | `render` (Astro answers with the configured status) |
| 7 | Matches an on-demand route with params | `file` at the mapped key, otherwise `render` |
| 8 | Matches a `_redirects` rule | the rule's redirect, or for status 200 a `file` at the target |
| 9 | Matches nothing on demand | trailing slash redirect if Astro's rule asks for one, else `file` at the mapped key, otherwise not found |

"Not found" is `file 404.html (404)` when the 404 page is prerendered, else `render`. Key mapping: a last segment with a dot is literal; otherwise `p/index.html` (`directory`) or `p.html` (`file`). One key per request, so one storage read at most.

`_redirects` sits after every on-demand row, so it only covers paths no on-demand route claims. A redirect from a path a dynamic route answers goes in Astro's `redirects` config (ADR 0008).

### Middleware

```mermaid
flowchart LR
  V[Visitor] --> C{Cache}
  C -->|hit| V
  C -->|miss| OR[onOriginRequest: decide]
  OR -->|render, redirect| R[Response, cached per Cache-Control]
  OR -->|file| S[Storage replica at deploys/id/key]
  S --> RS[onOriginResponse]
  RS -->|found| F[finalize: stored headers]
  RS -->|404| O[interpret otherwise]
```

- `onOriginRequest` rebuilds the visitor URL from `cdn-host`, since `request.url` is the storage origin there.
- A `file` decision returns a `Request` rewritten to `<assetPrefix>/<key>`; the visitor's `/deploys/...` is prefixed again and 404s (R-TYPE-2).
- The visitor path travels to `onOriginResponse` in a reserved query parameter on the rewritten URL, with a request header as fallback (proposed). Measured on bunny.net (2026-10-28): the hook sees the rewritten URL and the header, storage ignores the query, and the cache key stays the visitor URL.
- Both hooks catch everything and answer a `private, no-store` 500, since a throw gives an empty 500 with no fall-through.

### Standalone

- `serve(handler)`: decide, then for `file` read `<assetPrefix>/<key>` through `storage`; on 404 interpret `otherwise`.
- `storage` sets `Content-Type` from the file extension (proposed), since a Storage API read answers `application/octet-stream` for `.webmanifest` and extensionless files (measured 2026-10-28).
- `request.url` is already the public URL in standalone. The CDN strips `Range` and `If-*` and turns HEAD into GET before the script, so conditional and range requests are answered by the CDN (both measured 2026-10-28).

### Shared by both

- **Server code.** Everything is in the one script as plain code; nothing is fetched for code (ADR 0007, accepted). Until M4 the script hands every request to Astro's `fetch` through `Bunny.v1.serve`.
- **Deploy global.** `platform` reads `__BUNNY_DEPLOY__` on the first request, never at import, because a deploy tool's compat probe imports the raw script. Missing: a `private, no-store` 500, one log line naming the cause, no storage read. **(accepted)**
- Rendered responses get `clientAddress` from `x-real-ip`, `waitUntil` from `Bunny.v1.waitUntil`, cookies appended, and `prerenderedErrorPageFetch` reading `404.html` and `500.html` through `storage`, never `fetch()` to self.
- Every exit passes `caching.finalize`, storage 401, 403 and 5xx included (ADR 0005, proposed).
- The adapter logs no request data: no URLs with queries, cookies, IPs or bodies.

## Build flow

1. `astro:config:setup`: register the virtual module with build facts. Force `build.redirects: false`, `vite.ssr.noExternal: true`, and the Sharp split when the project uses the default service (ADR 0006).
2. `astro:config:done`: read `buildOutput` before `setAdapter()` and pass it back (ADR 0003). Turn on `staticHeaders` only when `buildOutput` is `"server"` **(accepted)**. Declare `envGetSecret: stable`, `sharpImageService: limited`, `i18nDomains: unsupported`. Derive `requires.env` from `env.schema` **(accepted)**. Log the script type in one line **(accepted)**.
3. `astro:build:setup`: point the server environment at the script type's entry.
4. `astro:build:generated`: take `routeToHeaders` and merge it with `_headers` into one table, per-page headers first.
5. `astro:build:done`: parse `_headers` and `_redirects` from `dist/client` (ADR 0008). When Astro emitted a server entry, whatever `buildOutput` said (a prerendered site with a `server:defer` island reports `"static"`), run `build/bundle` to write `dist/index.js`, warn above 7 MB and fail above 10 MB. Otherwise append Astro's redirects to `dist/client/_redirects` and warn when `_headers` and `_redirects` exceed 50 rules. Write `.bunny/build.json`.

No file list is written: static-first lookup does not need one.

## Options

| Option | Type, default | Why it exists |
| --- | --- | --- |
| `script` | `"middleware" \| "standalone"`, default `"middleware"` **(accepted)** | The two types need different zone setups. Middleware reads storage replicas for static misses (about 85 ms against 420 ms from New York). The type is fixed once the Edge Script exists: the API accepts a change and ignores it (measured 2026-10-28). |
| `staticCacheControl` | `string`, default `"public, max-age=0, must-revalidate"` **(accepted)** | `Cache-Control` for stored files outside `build.assets`. A consumer may opt into `s-maxage`, which needs a purge on publish and on rollback. |

Removed against the reference site's current adapter, each with the reason:

- `headers` **(accepted)**: `public/_headers` with a `/*` block does the same for stored files, and also works for static builds through the deploy tool (ADR 0008).
- `sessions`: Astro's own `session: false` already says it.
- `assetManifest`: static-first lookup makes the file list unnecessary.
- `imageService`: out of scope for v1 (ADR 0006).
- `BunnyRuntime` and `locals.runtime`: nothing reads it.
- No size, split or minify option: server code is always one plain script **(accepted)**, and the limits are bunny's.

## What the build emits for deploy tools

- `dist/index.js` **(accepted)**: the one script, as in the bunny CLI's examples. Holds the entry, `routing`, `caching`, all server code and the header table, unminified and without a source map (ADR 0007).
- `dist/client/`: every static file, prerendered pages, `_headers` and `_redirects` as written. No server code.
- `.bunny/build.json`, version 1 plus optional fields readers ignore (ADR 0004): `kind`, `script.{entry,type,bytes}`, `assets.dir`, optional `assets.immutable: ["_astro/"]`, `requires.pullZone`, `requires.env` with the storage variables for standalone only, the optional `BUNNY_API_KEY`, and the app's server secrets.
- Settings the adapter cannot express in v1 (`CacheControlMaxAgeOverride: -1`) go in the README as deploy requirements.

## How the reference site migrates

| Reference site today | After |
| --- | --- |
| `import bunny from "<vendored package>"` | `import bunny from "astro-adapter-bunny"` |
| `script: "middleware"` | unchanged (also the default) |
| `sessions: false`, `assetManifest: false` | removed; `session: false` in Astro config stays |
| `pageCacheControl` | `staticCacheControl`, same value |
| `headers` | its response headers module writes `public/_headers` with a `/*` block; its middleware keeps owning rendered responses |
| CSP with `frame-ancestors` in `headers` | lost on prerendered pages, since Astro's per-page CSP wins over `_headers`; must be re-added in Astro's CSP config |
| `BunnyRuntime` in its env type declarations | line removed |
| its deploy tool | no change: it reads the same v1 fields and already sets the storage variables |
| its Shiki alias | kept: one `<Code>` from `astro:components` adds about 11 MB of server code, and the site never highlights at runtime |

Proof: the reference site's builds deploy through its own deploy tool with its smoke tests, plus the checks of `docs/testing.md`.

## Clean room

This adapter is written without reading any other bunny.net adapter.

- **Never read** the source, tests, history or `node_modules` copies of: the reference site's vendored adapter, BunnyWay's adapter repositories, any `@bunny.net/*-adapter` package, or the prototype's adapter code. Not the git history of this repository from before the rewrite either.
- **Allowed**: Astro's documentation and the compiled `astro` package; official Astro adapters for patterns, described in your own words; bunny.net documentation, SDK types and CLI; Rolldown; the reference site's docs, config and deploy code.
- **Describe, do not copy.** Prior art reaches this repository only as behavior-only reports.
- **If you read a forbidden source by accident**, say so in your PR and step away from the module it concerns.

## Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| The script outgrows what bunny.net starts **[open]** | Publish refused, or every request 400 | Warn above 7 MB, fail above 10 MB, naming the five largest packages. bunny.net documents 10 MB and a 500 ms startup; generated plain code started at 7 MB in 1.2 to 1.3 s and never at 9.4 MB (measured 2026-10-28). Where real Astro output stops is a later measurement |
| One `<Code>` from `astro:components` pulls in all of Shiki | About 11 MB of server code (244 languages, 65 themes, the WebAssembly engine; measured in an Astro 7.4.2 build), over the limit | A known limit: a project that never highlights at runtime aliases Shiki out; prerendered pages are highlighted at build |
| `<Prism>` in an on-demand route fails at request time | prismjs loads its languages by a path computed at runtime | Deferred (M3b); prerendered pages are not affected |
| Memory per isolate | bunny.net documents 128 MB; an isolate keeps every module it evaluated | Not measured on bunny.net |
| Every on-demand request under a catch-all pays a storage miss first **[E]** | Slower catch-all pages | Measured in M4 and M5; an optional file table is a later, additive change |
| Some `node:` builtins break startup (measured: `child_process`, `vm`, `worker_threads`, `constants`, `path/win32`) | Every request 400 | The build refuses them (ADR 0007) |
| `max-age=0` pages revalidate at storage on every request | 275 ms per HTML request on the reference site | Opt-in `s-maxage` with purges; R-HDR-7 |
| `ASTRO_KEY` for server islands is read at build **[E]** | A key in the bundle, against R-BUILD-6 | Check in M3; document |
| The server output holds absolute paths of the build machine **[open]** | The project root and `node_modules` paths end up in the deployed script | Not checked yet whether Astro can avoid it |

## Open questions

1. Which Cloudflare `_redirects` and `_headers` features a static deploy can express as edge rules. The deploy tool owns that answer; the adapter warns only on the rule count (ADR 0008).
2. What `astro preview` runs: the real script against `dist/client` (proposed), decided in M6.
