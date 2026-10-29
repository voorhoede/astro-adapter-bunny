# Testing strategy

How the adapter is tested: which layers exist, what each one proves, which app and fixtures it runs against, and what runs where. Written 2026-10-28, before any code, and updated the same day for the decisions in `docs/design.md` and ADR 0001 to 0008. Where this document assumes something about the design, it says so.

## How to read this

- **[V]** verified: checked in a source named next to it.
- **[E]** expected: follows from a verified fact, not checked.
- **[?]** open: listed again under [Open questions](#open-questions).
- Bunny facts cite `docs/research/bunny.md` (`F:n` is a line in our own Bunny findings, as that document uses it). Astro facts cite `docs/research/astro.md`.

## Principles

- **Test first.** For every milestone, the check file is written and agreed before the code. The [traceability table](#requirement-to-test-traceability) is the list of expectations to agree on.
- **Lowest layer that can prove it.** A business rule is a unit test. A platform behavior is an HTTP check. Nothing is proven only live when a lower layer can prove it.
- **One set of HTTP checks, four targets.** The same check file runs against the local standalone run, the local middleware run, and both live script types. Expectations that genuinely differ between targets are guarded by name, never by loosening.
- **Every bug gets a regression test** at the lowest layer that reproduces it, run red before the fix and green after. A bug that only shows live and comes from platform behavior also gets a new rule in the pull zone emulator, with its `F:` citation.
- **No pixels.** Everything a visitor sees here is observable over HTTP, so there is no browser in the test setup.

## Test layers

| Layer | Proves | Runs | Speed |
| --- | --- | --- | --- |
| Unit | Pure rules: the per-request decision, path mapping, header and cache rules, build manifest | Node, no Astro, no runtime | Seconds |
| Build | What `astro build` emits: files, script, manifest, size, absence of secrets | Node, real Astro build of each fixture | About a minute for all fixtures [E] |
| Local runtime | Both script types serving a real build, on Deno, behind an emulated pull zone and storage | Deno for the script, Node for the checks | Seconds per app after build |
| Live | The same checks on Bunny, plus what only Bunny can show (CDN cache, PoPs, rollback, latency) | Bunny test account | Minutes, on demand |

### 1. Unit

- Colocated with the code as `src/<domain>/<module>.test.ts`, so a rule and its test change together.
- Table-driven: one row per case, named for the outcome (`"/about/ with format directory reads about/index.html"`).
- Covers:
  - **Decision core.** Given request facts (method, path, selected headers), build facts (base, `trailingSlash`, `build.format`, script type, `_redirects` rules) and the route match, it returns render, redirect, stored object or miss. Includes `/deploys/...` never reaching storage (R-TYPE-2), `/_bunny/`, `/_headers` and `/_redirects` answering not found, and a storage 404 falling through to render (R-TYPE-3).
  - **Path mapping and safety.** URL to storage key with the deploy prefix: base strip, decoding exactly once (`%252e` stays literal), `\` treated as a separator, `.` and `..` segments dropped, per-segment encoding, `directory` and `file` formats, `trailingSlash` per value, `404.html` and `500.html`.
  - **Header rules.** `_astro/` immutable, page cache policy for other stored files, `private, no-store` default for rendered responses, any 500 never cacheable, and no response ever leaving without `Cache-Control` (bunny.md, "No `Cache-Control` at all"). The two R-HDR-2 exceptions: a rendered response with `Set-Cookie`, or with a `Vary` other than `accept-encoding`, becomes `private, no-store` and logs the route pattern only.
  - **`_headers` and `_redirects` rules** (ADR 0008). Matching (splats, placeholders), several blocks combining, `! Name` detaching, statuses, status 200 to another stored file, query handling; Astro's per-page headers beating `_headers`; `_headers` never setting `Cache-Control`; nothing applied to rendered responses; a `_redirects` rule not applying to a path an on-demand route claims. Expected values come from Cloudflare's docs, cited per row.
  - **Request URL rebuild** from `cdn-host` and `https`, never `x-forwarded-host`, since `request.url` in middleware is the storage origin (`F:64`).
  - **Build manifest.** `.bunny/build.json` from build facts, including `assets.reserved` and `requires.env` derived from an env schema with secret, optional, defaulted and public fields (only server secrets listed; storage variables required in both types).
  - **Env accessor.** Reads at request time, falls back to compiled `envField` defaults (R-ENV-3).
- Assumption about the design: the decision core receives the route match as data (or as a function argument), so it needs no Astro manifest. If the design calls `app.match()` inside it, route collision cases such as R-ROUTE-2 move to the build and runtime layers.

### 2. Build

- Each fixture is built with Astro's programmatic `build()` and inline config overrides, the pattern official adapters use with one fixture source and several configs [V: `withastro/astro` `packages/integrations/node/test/`].
- Checks per build:
  - Layout: `dist/index.js` plus a client directory with parts under `_bunny/server/` (R-BUILD-2); the script imports nothing relative and loads parts only through its storage hook.
  - The script imports on its own: copied alone into an empty temp directory and imported under Deno with `globalThis.Bunny` stubbed and **no** `__BUNNY_DEPLOY__`. It must not throw, must register its handler and must fetch no part. This doubles as the startup probe.
  - Parts: every part's hash in the import map matches its file; parts per directly imported target stay within the budget of ADR 0007; the eager script is under the fail threshold.
  - Headers: `staticHeaders` is on only when a script is emitted; the parsed `_headers` and `_redirects` table matches the test app's files; a syntax error fails the build with the line number.
  - `sharp` appears in neither the script nor any part (ADR 0006).
  - `node:` imports are only those that work on Bunny (`F:175`, `F:176`).
  - `.bunny/build.json` matches the documented contract: fields, `script.bytes` equal to the file size, `requires.pullZone` values (R-BUILD-1).
  - Secrets: the build runs with known fake secret values in its environment, then the script, the parts, the client directory and the manifest are searched for them (R-ENV-2). Same search for the build host name and `localhost` (R-BUILD-6).
  - Sessions off: no session runtime in the script and no session storage in `requires` (R-ENV-4).
  - Size: raw and gzip bytes of the eager script and of each part, written to a JSON report (see [Measurements](#measurements-to-track)).

### 3. Local runtime

A harness in `test/harness/`, around 200 to 300 lines of our own [E], runs a built script the way Bunny would, on Deno.

- **Runtime.** Deno, pinned to the version Bunny reports (2.7.12 in `F:174`). The harness stubs `globalThis.Bunny.v1` (`serve`, `registerMiddlewares`, `waitUntil`), which is what the SDK calls on Bunny (`F:170`), so it works whether or not the bundle uses the SDK.
- **Deploy line.** It prepends `globalThis.__BUNNY_DEPLOY__ = { id, assetPrefix: "deploys/<id>", ... }` like both deploy tools do (R-BUILD-3), and can leave it out for the fail-closed check.
- **Fake storage.** An HTTP server serving the client directory under `deploys/<id>/`, requiring `AccessKey` for API reads (parts and error pages in both types, files in standalone) and sending a weak `etag` (`F:42`). Through the pull zone emulator it sets `content-type` from the extension (`F:155`). On Storage API reads it sends `application/octet-stream` until S1 step 6 says otherwise, so a test fails if the script relies on storage for the type.
- **Request log.** The harness logs every storage read. A check fails when one request reads more than one stored file; part reads are counted separately per route and compared with the budget.
- **Cache API stub.** `caches.default` and `caches.open` with `match`, `put`, `delete`, as Bunny documents them, empty per isolate and clearable, so the part transport's hit, miss and fallback paths run locally. Eviction timing is live-only (S1 step 3a).
- **Fault injection.** The fake storage can fail the next read of a named part, delay it, or serve altered bytes, for the split loading tests.
- **Pull zone emulator** (middleware). Each rule cites the fact it copies:
  - `onOriginRequest` gets `request.url` as `http://storage.bunnycdn.com:9000/...`, the public host in `host` and `cdn-host`, and `x-forwarded-proto: https` (`F:64`).
  - Added headers: `x-real-ip`, `x-forwarded-for`, `cdn-requestcountrycode`, `cdn-requestid` (bunny.md, "Request headers Bunny adds").
  - A returned `Request` is fetched from storage at its rewritten path, then passed to `onOriginResponse` (`F:40`). A returned `Response` skips it (`F:149`). A storage 404 reaches it (`F:157`).
  - A throwing hook gives an empty 500 with `cache-control: no-cache` (`F:43`).
  - A response without `Cache-Control` fails the check, because Bunny would cache it for 30 days (`F:45`, `F:146`).
- **Standalone.** The handler is called directly with the public URL. What `request.url` holds on Bunny in standalone mode is open (bunny.md question 1), so the harness uses the public URL and the first live run confirms it [?].
- **Privacy and processors.** The harness records every outbound request and all script console output. A check fails on any outbound host other than storage and the test upstream (the reference site's rule "No new third-party processors"), and on any cookie value, client IP or form field from the checks appearing in the output (the reference site's rule "No personal data").
- **Why our own emulator, not the SDK's `servePullZone`.** Whether the SDK reproduces the production `request.url` and Bunny's headers is open (bunny.md question 6), and that difference is exactly what breaks Astro's origin check. If a live run shows the SDK matches production, the emulator can shrink to it.

What local cannot reproduce, so it belongs to the live layer:

- CDN caching: `CDN-Cache` HIT or MISS, the max-age override, cookie stripping by `DisableCookies`, compression turning a strong `etag` weak.
- Header filtering by the CDN: `Range` and `If-*` dropped, HEAD sent as GET (only verified for URL origins).
- Bunny's Deno subset: local Deno is more permissive (`node:vm` works locally, fails on Bunny, `F:176`). The build check on `node:` imports covers part of this.
- Publish-time limits (9.5 MB scripts answering 400, `F:166`), startup limits, cold starts and isolate reuse; whether indirect `eval` and `s.js` run on Bunny at all (S1 step 1).
- Storage replicas, PoP propagation after a publish (`F:109`), variable propagation (`F:182`), rollback.

### 4. Live on Bunny

- **Smoke run.** Deploys the test app in both script types and runs the same HTTP checks with `live` set. Adds live-only checks: second request to a prerendered page is a `CDN-Cache` HIT, a private page never is, `Set-Cookie` survives, a cross-site POST is refused through the real zone.
- **Rollback run.** Publish release A, then B, republish A, check `/env` reads the current variables (R-ENV-5).
- **Measurement run.** See [Measurements](#measurements-to-track). Results go to `docs/measurements/<date>-<name>.md`, thresholds set before measuring and every number labeled measured or expected, as in the prototype's spike notes.
- **Resources.** One test account, one storage zone with a few replicas (so standalone and middleware latency differ measurably), and one script plus pull zone per script type. Kept between runs; each run uploads to its own `deploys/<id>/` folder. Creating zones per run adds known flakiness: a new storage zone refuses its password for seconds, and a new zone served 404 from one PoP for about a minute (`F:109`, observed in the prototype's first milestone).
- **Zone settings** are set by the deploy step, never assumed: `CacheControlMaxAgeOverride: -1`, `DisableCookies: false`, `EnableCacheSlice: false`, Smart Cache off (bunny.md, "Implications").
- **Cost.** Edge Scripting is priced at $0.20 per million requests plus $0.02 per 1000 s CPU (`F:209`, doc as recorded). A smoke run is a few hundred requests, so its script cost rounds to zero [E]. Storage and replica pricing and any account minimum were not checked [?].
- **Credentials.**
  - Bunny has one full-access account API key and no scoped keys (`F:210`). So the test account must not be one that holds the reference site's or other production zones.
  - The key lives in a GitHub environment `bunny-live` with a required reviewer, available only to `workflow_dispatch`, `schedule` and the release workflow on this repository. Never on `pull_request` or `pull_request_target` from forks.
  - Values fetched at run time, such as storage zone passwords returned by the API, are not GitHub secrets and are not masked automatically. The deploy script registers each with `::add-mask::` before anything else touches it, and filters CLI output to non-secret fields.
  - App secrets for the test app are fake values. They are still set as Bunny secrets, because what is tested is that secrets resolve at runtime.
  - A trial account without a verified card gets suspended mid-run (`F:136`), so the account needs a card on file.

## Test app and fixtures

### Recommendation: one full app plus small fixtures

| Option | For | Against |
| --- | --- | --- |
| One full example app | One place to see every feature; one live deploy | Cannot cover what needs another config: `base`, `trailingSlash`, `build.format`, fully static output, the size limit. Those either go untested or turn the app into a config matrix nobody can read |
| Fixture per scenario (official adapters) | Each fixture is small and readable; any config is possible | No single app that looks like the reference site; the interactions between features (catch-all next to integration files, CSP plus `_headers` plus cookies) never meet; many builds |
| **Full app plus small fixtures (recommended)** | The full app is shaped like the reference site and carries the interactions; fixtures cover only what cannot share its build | Two kinds of test target to learn |

- The full app is built four ways from one source: script type `standalone` and `middleware`, times `output: 'static'` (with on-demand routes, as the reference site's production build) and `output: 'server'` (as its preview build). Script type and output come from two environment variables read in its `astro.config.ts`.
- Pages that should behave the same in both outputs set `prerender` explicitly. A few pages leave it unset, to show the difference between outputs.
- Every PR builds all four. The live smoke deploys `static` output in both script types, and `server` output in middleware mode (as the reference site's preview build).

### Layout

```
src/<domain>/*.test.ts         unit tests, next to the code
test/
  harness/                     Deno runtime harness: Bunny.v1 stub, fake storage, pull zone emulator
  http.ts                      request helper: local or live origin, redirects not followed
  app/                         the full test app
    astro.config.ts            reads TEST_SCRIPT and TEST_OUTPUT
    src/
    build.test.ts              build-level checks, for the app and the fixtures
    app.test.ts                HTTP checks, run against all four targets
  fixtures/
    routing/                   tiny site built with several inline configs
    static-only/               no on-demand routes at all, with _headers and _redirects
    static-islands/            prerendered pages plus one server:defer
    oversize/                  a generated 11 MB module, as a part and forced eager
  live/                        deploy, rollback and measurement scripts
docs/measurements/             results of measurement runs
```

- Each app or fixture folder holds its source, so a scenario is one folder. The build-level checks of the app and of `static-only` and `static-islands` live together in `test/app/build.test.ts`.
- `npm test` runs only `*.test.ts` files under `src/` and `test/`, so nothing a fixture build writes is picked up as a test.
- `test/` rather than `examples/`: these apps are shaped for assertions (`/cookies`, `/boom`), not for reading as usage examples. An `examples/` folder can come later if the README needs one, and stays out of the test path.

### Routes of the full app

| Route | Rendering | What it proves | Requirements |
| --- | --- | --- | --- |
| `/` | prerendered | Prerendered HTML from storage with `_headers` and exactly one CSP, Astro's; links a hashed `_astro/` script and a font from the fonts API | R-ROUTE-1, R-HDR-1, R-HDR-3, R-HDR-6, R-IMG-2 |
| `/about` and `/about/` | prerendered | Directory requests resolve to `about/index.html` under Astro defaults | R-ROUTE-8 |
| `/robots.txt` | public file | A public file gets `_headers` and the page cache policy, not the immutable one | R-HDR-1, R-HDR-3 |
| `/legacy`, `/legacy/*` | `_redirects` | A 301 and a splat redirect for paths no route claims; a 200 rule serving another stored file | R-ROUTE-7, ADR 0008 |
| `/_headers`, `/_redirects`, `/_bunny/server/<part>` | none | Answer 404; a part is never served to a visitor | ADR 0007, ADR 0008 |
| `/sitemap-index.xml`, `/sitemap-0.xml` | written by `@astrojs/sitemap` after the adapter | A file in storage wins over the `[locale]` catch-all | R-ROUTE-2 |
| `/service-worker.js` | written by a local integration in `astro:build:done`, registered after the adapter | Same, for a file Astro never knew about | R-ROUTE-2 |
| `/[locale]/` | on demand | `en` and `nl` render; anything else rewrites to `/404/?locale=...` and keeps 404 | R-ROUTE-4, R-ROUTE-5 |
| `/[locale]/[...path]/` | on demand | A CMS-like map: known paths render, redirect entries return 301, 302, 307 and 308, unknown paths rewrite to 404 | R-ROUTE-4, R-ROUTE-5, R-ROUTE-7 |
| `/404` | on demand | Reads `locale` from the query; is what a storage 404 falls through to | R-ROUTE-5, R-TYPE-3 |
| `/api/[...notFound]` | on demand endpoint | Rest param endpoint answering a JSON 404 | R-ROUTE-4 |
| `/api/content/[...path].md` | on demand endpoint | Endpoint with a file extension that sets its own `Cache-Control`, passed through untouched | R-ROUTE-4, R-HDR-4, R-HDR-5 |
| `/files/[...filename]` | on demand endpoint | Outbound `fetch` with a streamed body of several MB from a test upstream (local: a harness server; live: a large file in the same storage) | R-PREV-5 |
| `/injected` | injected by a local integration | `injectRoute` works like a file route; the integration's `pre` middleware sets a marker header | R-ROUTE-3 |
| `/proxied/*` | user middleware | Middleware returns a response with `X-Astro-Rewrite: true` and status 404 or 200; status kept | R-ROUTE-6 |
| `/headers` | on demand | Sets its own `X-Frame-Options`; neither `_headers` nor middleware overwrite it, and `_headers` adds nothing to it | R-HDR-2 |
| `/cached-cookie`, `/cached-vary` | on demand | Set `public, max-age=300` with a `Set-Cookie`, and `s-maxage=60` with `Vary: cookie`; both leave as `private, no-store` and log the route pattern only | R-HDR-2 exceptions |
| `/private` | on demand | No `Cache-Control` from the route: answers `private, no-store`; live, never a `CDN-Cache` HIT | R-HDR-4, R-HDR-5, R-PREV-4 |
| `/preview-check` and `/` | on demand and prerendered | Middleware reads cookies only when `isPrerendered` is false; the page prints which branch ran | R-PREV-3 |
| `/cookies` | on demand endpoint | Echoes request cookies; sets three `Set-Cookie` headers with `HttpOnly`, `Secure`, `SameSite=None`, `Partitioned` | R-PREV-1, R-PREV-2 |
| `/env` | on demand | Prints a fake runtime secret, an optional one, and two `envField` defaults absent at runtime | R-ENV-1, R-ENV-3, R-ENV-5 |
| `/form` | on demand, POST | Same-origin POST accepted, cross-site POST refused with 403, in both script types | Upcoming reference site form need, `F:64` |
| `/island` | prerendered page with `server:defer` | The island URL in the HTML answers 200 from `/_server-islands/...` | G-5 (Should) |
| `/code` | on demand | Astro `<Code>` (Shiki), loaded as server parts; the page the per-route budget and cold loads are measured against | R-BUILD-5, measurements |
| `/boom` | on demand | A thrown error gives Astro's 500 page with `private, no-store`, not Bunny's empty 500; a prerendered `500.html` read through the error hook is never cacheable either | R-HDR-4 |
| `/old`, `/moved`, `/blog-old/[slug]` | `redirects` config | Real 301 and 302 with parameters, not meta-refresh | R-ROUTE-7 |
| `/deploys/<id>/robots.txt` | none | Answers 404; storage layout unreachable | R-TYPE-2 |
| `/not-a-locale`, `/favicon.ico` | none | The site's own 404 page with status 404 | R-ROUTE-5, R-TYPE-3 |

Config of the full app: `security.csp` on, `session: false`, a no-op image service, the fonts API, `public/_headers` with a `/*` security baseline plus `Link` and a per-path block, `public/_redirects`, an `astro:env` schema with secret, optional, defaulted and public fields, and the page cache policy `public, max-age=0, must-revalidate` (the reference site's values).

### Fixtures

| Fixture | Built with | Proves | Requirements |
| --- | --- | --- | --- |
| `routing` | `base: '/docs'` with `trailingSlash` `always`, `never`, `ignore`; `build.format: 'file'` with `never`; both script types | Non-default routing config behaves as Astro documents, for stored files and rendered routes | G-3, R-ROUTE-8 |
| `static-only` | no on-demand routes, with `_headers`, `_redirects` and `security.csp` | No script, `kind: "static"`, the CSP still a `<meta>` tag (`staticHeaders` off), both files copied unchanged into `dist/client`, a warning when a variant has more than 50 rules; Astro's own preview serves it | R-ROUTE-1, ADR 0003 |
| `static-islands` | only prerendered pages plus one `server:defer` | Gets a script, because Astro emits a server entry although it reports `buildOutput: "static"` (L1 step 1) | G-5, ADR 0003 |
| `oversize` | a generated module of about 11 MB behind one on-demand route | The build succeeds with it as a part; a variant that pulls it into the eager script fails the build [E: L2 decides how to force it eager] | R-BUILD-5, G-8 |

Later, with their Should requirements: an `i18n` fixture for Astro's own `i18n` routing (it cannot share a build with the full app's hand-rolled `[locale]` routes), and a `sessions` fixture once a driver exists.

## Requirement-to-test traceability

Every Must from `docs/requirements.md`. Layers: **U** unit, **B** build, **L** local runtime, **Live**.

### Options and entry points

| Requirement | Check | Layers |
| --- | --- | --- |
| Default export called as `bunny({...})` | Every fixture's config calls it; type check of the config | B |
| `script` option, `'middleware'` | Full app built and served in both types | B, L, Live |
| `sessions` off | See R-ENV-4 | B |
| `assetManifest: false` behavior | See R-ROUTE-2 | L, Live |
| `pageCacheControl` | `/robots.txt` and `/about` carry the configured value | U, L, Live |
| `headers` on every stored file | Replaced by `public/_headers` with `/*`; see R-HDR-1 | U, L, Live |

### Build output and deploy contract

| ID | Check | Layers |
| --- | --- | --- |
| R-BUILD-1 | `.bunny/build.json` fields and values per build; `script.bytes` equals file size | U, B |
| R-BUILD-2 | `dist/index.js` importing nothing relative; parts under `dist/client/_bunny/server/`; client files in their own directory | B |
| R-BUILD-3 | Harness prepends the deploy line with a prefix; stored files load from that prefix; a second prefix serves a second build | L, Live |
| R-BUILD-4 | Both types read parts and error pages, and standalone reads files, with `AccessKey` from `BUNNY_STORAGE_*`; a wrong key answers 500 and logs once per isolate | L, Live |
| R-BUILD-3, fail closed | Script imported without the deploy global does not throw; a request answers `private, no-store` 500 with one log line and no storage read | B, L |
| R-BUILD-6 | No host name, `localhost` or secret in the output; one build served under two hosts and two prefixes | B, L |

### Script types

| ID | Check | Layers |
| --- | --- | --- |
| R-TYPE-1 | Middleware: on-demand routes render, everything else reaches storage under the prefix | U, L, Live |
| R-TYPE-2 | `/deploys/<id>/robots.txt` answers 404 | U, L, Live |
| R-TYPE-3 | A missing stored file falls through to Astro: the 404 page, redirects and `/proxied/*` run | U, L, Live |
| R-TYPE-4 | The same `app.test.ts` passes in standalone mode | L, Live |
| G-1 | Both modes in the full app; mode chosen by one option with a default | B, L, Live |

### Routing

| ID | Check | Layers |
| --- | --- | --- |
| R-ROUTE-1 | Full app in `static` and `server` output; `static-only` fixture | B, L, Live |
| R-ROUTE-2 | `/sitemap-index.xml`, `/sitemap-0.xml`, `/service-worker.js` answer the file, not the catch-all's 404; live, a file uploaded outside the build also wins | U, L, Live |
| R-ROUTE-3 | `/injected` renders; integration middleware marker present on rendered routes | L |
| R-ROUTE-4 | Each param route listed above | L |
| R-ROUTE-5 | `/xx/` and `/nl/unknown/` answer 404 with the 404 page and the locale from the query | L, Live |
| R-ROUTE-6 | `/proxied/*` keeps 404 and 200 | L |
| R-ROUTE-7 | Config, `Astro.redirect()` and endpoint redirects keep status and `location` | L, Live |
| R-ROUTE-8 | `/about` and `/about/` give `about/index.html`; `routing` fixture with defaults | U, L |
| G-3 | `routing` fixture across its configs | U, B, L |

### Headers and caching

| ID | Check | Layers |
| --- | --- | --- |
| R-HDR-1 | `_headers` on `/`, `/robots.txt`, an `_astro/` file and `/service-worker.js`; not on `/private` | U, L, Live |
| R-HDR-2 | `/headers` keeps its own value; `/cached-cookie` and `/cached-vary` are the two exceptions | U, L |
| R-HDR-3 | `_astro/` file: `public, max-age=31536000, immutable`; other stored files: page policy | U, L, Live |
| R-HDR-4 | `/private` and `/boom` answer `private, no-store`; `/api/content/...` keeps its own | U, L, Live |
| R-HDR-5 | Emulator fails any response without `Cache-Control`; live, `/private` is never a HIT and a `public` page becomes one | L, Live |
| R-HDR-6 | CSP with hashes on prerendered and on-demand pages equals what Astro computed at build; exactly one CSP per page, the 404 included, none on assets | B, L, Live |

### Preview, cookies and the CMS

| ID | Check | Layers |
| --- | --- | --- |
| R-PREV-1 | Three `Set-Cookie` headers with all attributes, read with `getSetCookie()` | L, Live |
| R-PREV-2 | `/cookies` echoes the request cookie through a live zone | L, Live |
| R-PREV-3 | `/preview-check` shows the cookie branch; `/` shows the prerendered branch | L |
| R-PREV-4 | `server` output build: every page private, no HIT on repeat requests | L, Live |
| R-PREV-5 | `/files/...` streams a multi-MB body; first bytes arrive before the upstream finishes [E: harness upstream sends in chunks with delays] | L, Live |

### Sessions, env and secrets

| ID | Check | Layers |
| --- | --- | --- |
| R-ENV-1 | `/env` shows the runtime secret value set on the script, not a build value | L, Live |
| R-ENV-2 | Build run with known fake secrets; none found in script, client or manifest | B |
| R-ENV-3 | `/env` shows compiled defaults when the variables are absent | U, L |
| R-ENV-4 | `session: false` build has no session runtime and needs no storage binding | B |
| R-ENV-5 | Rollback run on Bunny | Live |

### Images, assets, development, release

| ID | Check | Layers |
| --- | --- | --- |
| R-IMG-1 | Full app builds and serves with a no-op image service | B, L |
| R-IMG-2 | Font files from the fonts API served from `_astro/` with immutable caching | B, L |
| R-DEV-1 | `astro dev` on the full app on port 4323 answers `/` and `/en/` | B (smoke) |
| G-2 | The live run deploys with the documented deploy path for both modes | Live |
| G-9 | CI checks `peerDependencies.astro`, `engines.node`, a `changelog.md` entry per user-facing change, and installs with `npm ci --ignore-scripts`; publish with provenance in the release workflow | CI |

### Reference site rules

| Rule | Check | Layers |
| --- | --- | --- |
| Install without scripts | `package.json` has no install lifecycle scripts | CI |
| No new third-party processors | Harness fails on any outbound host other than storage and the test upstream | L |
| No personal data | Harness fails when a cookie value, client IP or form field appears in script output | L |

### Server parts (ADR 0007)

| Check | Layers |
| --- | --- |
| `/code` renders from parts in both script types | L, Live |
| No part is fetched at import; the first request loads only its route's parts | L |
| A part fetch that fails once: that request answers 500, the next request retries and renders | L |
| Two concurrent first requests needing one part cause one fetch | L |
| A part with altered bytes answers `private, no-store` 500 and is not evaluated | L |
| Part reads per route stay within the budget | B, L |
| A visitor requesting a part path gets 404 and nothing is cached | L, Live |

### Should, planned coverage

R-BUILD-5 and G-8 (`oversize`), R-HDR-7 (unit rules once decided), R-HDR-8 (live: 304 on repeat with `If-None-Match`), R-DEV-2 (fixture with Vitest, see open questions), R-DEV-3 (`astro preview` smoke on the full app), G-4 (`sessions` fixture), G-5 (`/island`), G-6 (`i18n` fixture), G-7 (`/env` prints client IP and country from `locals`, local only for the values), G-10 (CI check that the harness sees no outbound host other than storage and the test upstream, and that the suite passes after `npm ci --ignore-scripts`).

## Tooling

| Need | Choice | Cost | Lighter alternative, and when the choice would change |
| --- | --- | --- | --- |
| Test runner | `node:test` with `node:assert/strict` | None beyond Node; Astro's own suite uses it [V: `withastro/astro` `scripts/cmd/test.js`] | Already the lightest. Vitest (used in the prototype) only if snapshots or module mocking become necessary, which the deep-module design should avoid |
| TypeScript in tests | Node's built-in type stripping | None; available unflagged in current Node [E] | A loader like `tsx` only if a test needs syntax type stripping refuses |
| Runtime under test | Deno, pinned to Bunny's reported version | One more runtime in CI, about 10 s setup [E] | Running the harness on Node is cheaper but misses Deno differences, the class of bug that only shows on Bunny |
| Storage, pull zone, Bunny API | Own harness in `test/harness/` | Our code to maintain; each rule cites a finding | MSW or undici mocks only work in-process, and the script runs in a Deno process. The SDK's `servePullZone` if it proves faithful (open) |
| HTML assertions | Regex on the response text, as in the prototype's checks | None | A parser only if regexes start to break on real markup |
| Browser | None | None | Playwright only when a client-side behavior becomes a requirement |
| Live deploy | The documented deploy path (see open questions) | Account and credentials | Bunny CLI directly |
| Latency from many cities | Globalping, as in the prototype's spikes | Free tier; limits not checked [?] | `curl` timings from the CI runner, one location only |

## CI shape

| When | What | Secrets |
| --- | --- | --- |
| Every pull request | Type check, unit, build-level on all fixtures and the four full app builds, local runtime checks on Deno for both script types, bundle size report as job summary compared with `main` | None |
| `workflow_dispatch`, with inputs for ref, script types and whether to measure | Live smoke, optional rollback run, optional measurement run | `bunny-live` environment |
| Weekly schedule | Live smoke, recording `Deno.version` from the script, to catch Bunny platform changes between our releases | `bunny-live` environment |
| Release workflow | Live smoke on the release commit before publish | `bunny-live` environment |

- Forks get the pull request jobs only.
- A red live run on `main` is triaged like a failing test: reproduced at the lowest layer, or recorded as a platform change in `docs/measurements/`.

## Measurements to track

| Measurement | How | Where and when |
| --- | --- | --- |
| Script size, eager | Raw and gzip bytes of `dist/index.js` per build | Every PR, compared with `main`; warn above 1 MB, fail above 7 MB (proposed, ADR 0007) |
| Parts | Largest part, total, files reachable per route | Every PR, compared with `main` and the budget |
| Startup probe | Deno import time of the script alone, `Bunny.v1` stubbed | Every PR. A signal for top-level work only: a local import is no timing match for the edge (`F:134`) |
| Cold start on Bunny | First byte on `/env` (small) and `/code` (Shiki) per script type, from ten cities after 30 min idle, then again at once; a small app split against one module once (S1 step 3c) | Measurement run. A cold-path measurement in the prototype showed low-traffic requests are nearly always cold, so the second round is not assumed warm |
| Part hashing | SHA-256 time per MB, locally (L2) and on Bunny (S1) | Once, then when parts grow |
| Static miss latency per script type | First byte on files uploaded fresh for the run (guaranteed misses without a purge), from ten cities | Measurement run. Compare with `F:55` to `F:63` (New York: about 420 ms standalone, 85 ms middleware) |
| HTML hit vs miss | First byte on `/` and `/about`, first and second request | Measurement run; feeds requirements question 2 (an open performance issue on the reference site) |
| Conditional requests | Repeat with `If-None-Match`, status and first byte | Measurement run; decides whether R-HDR-8 becomes Must |

Cities follow the prototype's cold-path measurement: Amsterdam, Frankfurt, London, New York, Los Angeles, São Paulo, Singapore, Tokyo, Sydney, Johannesburg.

## Open questions

1. **Size thresholds.** Proposed for the eager script: warn above 1 MB raw (2 MB of code already cost 460 to 520 ms cold, `F:168`), fail above 7 MB raw (under the lowest failure any source saw). Confirm or set others.
2. **Per-route budget.** Settled in ADR 0007 from L2: at most 8 parts per directly imported target at build. No runtime guard until a request is shown to fail on subrequests.
3. **Test account.** The API key is account-wide (`F:210`), so live tests need a Bunny account with nothing else in it. Who owns it, and who pays?
4. **Live triggers.** Manual, weekly and release gate as proposed, or also a pull request label?
5. **Live deploy path.** bunny-edge-deploy (tests `.bunny/build.json` end to end with a real reader), the Bunny CLI, or our own script? Depends on what G-2 documents.
6. **Manifest contract test.** Run bunny-edge-deploy's manifest reader on every build's `.bunny/build.json` in CI, pinned to a commit?
7. **Reference site canary.** Build the reference site with the new adapter in its own CI before switching? That lives in the reference site's repository, not here.
8. **R-DEV-2.** Is a Vitest fixture worth Vitest as a dev dependency, for a Should?
9. **`@astrojs/sitemap` in the test app,** or only a local integration that writes the same files? The real one is closer to the reference site and costs a dev dependency.
10. **Persistent test zones.** Keep one zone per script type between runs (recommended, cheaper and less flaky), or create and delete per run (cleaner, slower, flakier)?
