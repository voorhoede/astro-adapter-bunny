# Prior art: existing bunny.net adapters

A dirty-room review of the existing bunny.net Astro adapters, written for the clean-room team. It describes behavior only. It holds no code, and no identifiers beyond public Astro and bunny.net names and the deploy contract names our own plan already uses. Reviewed on 2026-10-28.

Nothing here is true because the prior art does it. Anything marked "verify first" needs the named test or spike before the team adopts it.

## Sources and tags

| Label | Source | What it adds |
| --- | --- | --- |
| BW | BunnyWay/bunny-adapters on GitHub, `main` as of 2026-10-28 | The published `@bunny.net/astro-adapter` 0.1.0. Astro is the only package there. Its whole history is one squashed release commit (2026-08-25) plus two housekeeping commits |
| VF | Voorhoede's fork of BW (local) | Five commits on 2026-09-30: the middleware script type, a local pull zone origin, shared runtime code, middleware tests |
| PF | A production fork used by a reference site | VF imported on 2026-10-14, then two production fixes the same day |

Every claim carries a tag:

- **[read: label path]**: seen in that repository's source, docs, tests or history. Paths are relative to the repository.
- **[doc]**: bunny.net or Astro documentation, as cited by the prior art or our research. I did not re-fetch the docs.
- **[guess]**: my inference. Treat as unverified.
- Claims about our own plan cite `docs/` files in this repository as **[read: plan path]**.

Because BW squashed its history, most "pitfalls with dates" come from measurements dated inside comments and docs, from a planning document BW deleted on 2026-08-25 (still in its history), and from VF and PF commit messages.

## Verdicts at a glance

| Topic | Verdict | One line |
| --- | --- | --- |
| Routing and static lookup | Adapt | Keep our static-first lookup; take their test cases and the "one storage read at most" assertion |
| Script types and hooks | Adapt, verify first | Carry the miss through the rewritten URL, not a header; their key-derived fallback path is lossy |
| Storage access and path safety | Adopt | Their decode-once, both-separators, encode-per-segment rule and request log are the right shape |
| Headers and caching | Adopt, with gaps to close | Content type, length, immutable-headers copy, never-cached 500. Our plan misses content type in standalone |
| Redirects and error pages | Adapt, verify first | Our "Astro renders redirects" is simpler than their inlined table, if it holds at runtime |
| Env and secrets | Adopt | Runtime-only secrets, a bundle scan that includes `astro:env` defaults |
| Sessions, cache provider, images | Adopt the deferral | Their designs are a good later starting point; two platform blockers are real |
| Bundling and size limits | Verify first | Their measured start failure is near 7.8 MB, below our 9 MB failure line |
| Build manifest and deploy | Adapt, verify first | Island detection and `_headers` support contradict our ADRs |
| Preview and dev | Verify first | They run the real bundle on Deno; we run `decide` on Node |
| Testing approach | Adopt | Request logs, a per-script-type rerun, a careful live tier |

## 1. Routing and static lookup

### What they do

- Order per request in a standalone script: Astro's route match first, then a table of prerendered redirects, then a storage read, then Astro renders its 404 path. [read: BW packages/astro/src/runtime/site.ts]
- At the end of the build the adapter lists `dist/client` and inlines the file list in the bundle. A path the list holds costs one storage read; a path it lacks costs none. [read: BW packages/astro/src/build/manifest.ts, packages/astro/src/runtime/site.ts]
- Without the list (disabled, or more files than a threshold), an extensionless path tries two keys in turn: the directory index, then the `.html` file. That is up to two subrequests. [read: BW packages/astro/src/runtime/paths.ts]
- Key mapping: a last segment containing a dot is taken literally; the root maps to `index.html`. [read: BW packages/astro/src/runtime/paths.ts]
- `base` is stripped before lookup. A path outside `base` has no key and goes to Astro. A longer prefix that merely starts like `base` does not count as inside it. [read: BW packages/astro/src/runtime/paths.ts, tests/suites/base-path.test.mjs]
- A write method on a path that holds a stored file answers 405 with `Allow: GET, HEAD` and a no-store header. A write method on an unknown path goes to Astro, so it gets the site's 404. [read: BW packages/astro/src/runtime/site.ts, tests/suites/ranges.test.mjs]
- No `trailingSlash` handling appears in the runtime; stored pages answer under both forms. [read: BW packages/astro/src/runtime/site.ts, by absence] [guess] Astro's own rules apply only to rendered routes.

### Problem it solves

The script has a budget of 50 subrequests per request, and a storage round trip per miss is slow, so the list turns "maybe" into a lookup. [read: BW packages/astro/README.md, section on the file list]

### Pitfalls and fixes in history

- **2026-10-14 (PF):** the reference site turned the list off because the adapter lists files before `@astrojs/sitemap` and a service worker write theirs. With routes matched first, a catch-all on-demand route then claims those late files. [read: PF history, 2026-10-14] This is the bug our ADR 0002 exists for. [read: plan docs/adr/0002-static-first-file-lookup.md]
- **2026-09-30 (VF):** without the list, middleware mode tries only the directory index form, so `build.format: "file"` sites get 404s. [read: VF packages/astro/README.md, section "Middleware mode"]
- The list has a real size cost: 8,824 paths cost 410 kB of bundle. [read: BW packages/astro/src/index.ts] The threshold disagrees with itself: 5,000 in code, 20,000 in the option docs and README. [read: BW packages/astro/src/index.ts, packages/astro/src/types.ts, packages/astro/README.md]

### Versus our plan

- Ours asks storage first for any GET or HEAD a dynamic on-demand route would claim, with one key per request and no list. [read: plan docs/design.md, decision table] That fixes the late-file bug by construction, which their order cannot.
- Ours sends every non-GET to Astro. Theirs answers 405 for a write to a known stored file. Both are defensible; ours needs no storage read to decide.

### Verdict: adapt

- Keep static-first. Do not adopt a build-time file list as the source of truth.
- Adopt as tests: the longer-prefix base case, and an assertion that one request causes at most one storage read (their emulator records every path it was asked for).
- The cost of a storage miss under a catch-all is still unmeasured on both sides. Spike S1 covers it. [read: plan docs/plan.md]

## 2. Script types and pull zone hooks

### What they do

- Standalone registers one request handler with the SDK. Middleware registers an origin-request and an origin-response hook through the SDK's pull zone helper. [read: BW packages/astro/src/server.ts; VF packages/astro/src/middleware.ts]
- Off the network, middleware does not use the SDK's local pull zone. It runs both hooks itself against a local origin, because the SDK's local proxy (version 0.12.1) answers every origin response with 200, losing 404, 304 and 206. [read: VF packages/astro/src/middleware.ts, docs/writing-an-adapter.md]
- The visitor URL is rebuilt from the `host` header and `x-forwarded-proto`; any value other than "http" counts as https. [read: VF packages/astro/src/runtime/origin.ts]
- **The origin-response hook recovers which file was asked for from the rewritten request URL**, by removing the deploy folder prefix. No header and no shared state cross the hooks. [read: VF packages/astro/src/runtime/origin.ts]
- On a storage 404, or a URL outside the deploy folder, it renders Astro at `base` plus the storage key, not at the visitor's original path. [read: VF packages/astro/src/runtime/origin.ts]
- Any other non-success storage status, except 304 and 416, is returned unchanged. [read: VF packages/astro/src/runtime/origin.ts]
- Default script type is standalone. [read: BW packages/astro/src/index.ts]
- Measured 2026-09-30, Frankfurt main region with a New York replica, median cache miss for a file: from New York 420 ms standalone against 90 ms middleware; from Europe about equal (105 and 110 ms). [read: VF packages/astro/README.md, commit "Build a middleware script", 2026-09-30]
- A `Range` request that misses the cache was answered with the whole file by a middleware pull zone (measured 2026-09-30), where standalone answers 206. [read: VF packages/astro/README.md]

### Pitfalls and fixes in history

- **Script type is fixed at creation.** Moving an existing site from standalone to middleware means a new script and a new pull zone, and moving the domains. [read: BW history, plans/one-command-deploys.md, deleted 2026-08-25]
- The key-derived fallback path means Astro sees `/x/index.html` where the visitor asked for `/x`. [read: VF packages/astro/src/runtime/origin.ts] [guess] Harmless for them, since only the 404 path reaches it; harmful for our design, where the fallback can be a real dynamic route.
- Storage error statuses pass through without `Cache-Control`. [read: VF packages/astro/src/runtime/origin.ts] [guess] Under a zone that caches header-less responses for 30 days, a transient storage error could stick.

### Versus our plan

- Our plan carries the visitor path in a request header and lists "does a header survive between hooks" as open spike S1. [read: plan docs/design.md, Middleware] Our own research already measured that the origin-response hook sees the rewritten URL. [read: plan docs/research/bunny.md] So the URL is a proven carrier and the header is not needed if the URL can hold what we need.
- Their carrier (the key) is lossy: trailing slash, `.html` versus directory form and `base` are gone. Our `otherwise` needs the original path.
- Host: they use `host`, we use `cdn-host`. Our research measured both as the public hostname. [read: plan docs/research/bunny.md] No conflict.

### Verdict: adapt, verify first

- **[unverified] Better option:** put the visitor's original path (and query) into the rewritten URL itself, for example as a reserved query parameter, and recompute the decision in the origin-response hook. Our design already lists this as the fallback. [read: plan docs/design.md, Risks]
- **Spike (extends S1):** a middleware script rewrites to the deploy folder and appends the original path as a query parameter. Check: (a) the origin-response hook sees it; (b) storage ignores the query and serves the file; (c) the pull zone cache key is the visitor URL, not the rewritten one, by requesting the same visitor path twice and checking `CDN-Cache: HIT`; (d) two visitor paths that map to the same key do not share a cache entry wrongly.
- Every status leaving the origin-response hook goes through our `finalize` (ADR 0005), including storage 401, 403 and 5xx.
- Default middleware stays defensible, but write the "type is fixed at creation" fact next to open question 1 in the design.

## 3. Storage access and path safety

### What they do

- Standalone reads the Storage HTTP API with the zone's read-only password in the `AccessKey` header. The password comes from the environment only, never from an option. [read: BW packages/astro/src/runtime/storage.ts, packages/astro/README.md]
- Path rule: decode exactly once (a malformed escape is kept raw), split on both slash and backslash, drop empty, `.` and `..` segments, rejoin. Before the key goes back into a URL, every segment is percent-encoded on its own. [read: BW packages/astro/src/runtime/paths.ts]
- Why per-segment encoding: handing decoded text to the URL parser decodes it a second time, so an encoded dot pair climbs a level and a `?` starts a query, both reaching outside the zone with the password attached. Why backslash: the URL parser treats it as a separator for https URLs. [read: BW packages/astro/src/runtime/paths.ts]
- Every storage URL is built in one place, which adds the deploy folder, so nothing can skip the prefix or the encoding. [read: BW packages/astro/src/runtime/storage.ts]
- A 401 or 403 from storage is logged once per isolate and answered to the visitor as a 404. A freshly created zone can answer 401 until it propagates. [read: BW packages/astro/src/runtime/storage.ts, packages/astro/README.md, Troubleshooting]
- Unread storage bodies are cancelled so connections are not held. [read: BW packages/astro/src/runtime/storage.ts]
- Deploy folder: the injected deploy global first, then a `BUNNY_ASSET_PREFIX` variable, then the zone root. [read: BW packages/astro/src/runtime/deploy.ts]
- A storage-origin pull zone exposes the whole zone; in middleware mode the script is the only thing keeping other folders private, and it refuses to forward into the session folder. [read: VF packages/astro/README.md, packages/astro/src/runtime/origin.ts]

### Versus our plan

- Ours refuses to serve when the deploy global is missing, rather than falling back to a variable or the zone root. [read: plan docs/adr/0004-build-manifest-and-deploy-handshake.md] A variable is not part of a release, so their fallback breaks "code and files roll back together". Ours is stricter and better.
- Our `storage` module names conditional headers and validators but not path encoding or a config-error log. [read: plan docs/design.md, Module map]

### Verdict: adopt

- Adopt the path rule and the reason for each step as test cases.
- Adopt the once-per-isolate log for a refused zone.
- Avoid the variable and zone-root fallback.

## 4. Headers and caching

### What they do

- A rendered response with no `Cache-Control` gets `private, no-store` (configurable). [read: BW packages/astro/src/runtime/site.ts]
- Some responses have immutable headers (`Response.redirect()`, and the external redirect Astro builds with it). Setting a header throws, so they copy the response first. [read: BW packages/astro/src/runtime/site.ts]
- Stored files get a content type from the file extension, with a charset on text types, because (per a comment) the Storage API answers `application/octet-stream`. [read: BW packages/astro/src/runtime/mime.ts]
- Stored files always get `Accept-Ranges: bytes`, and copy `ETag`, `Last-Modified` and `Content-Range`. `Content-Length` is copied only when storage sent no `Content-Encoding`, because a decoded body has another length. [read: BW packages/astro/src/runtime/site.ts]
- Status: a stored success becomes 200, except 206, 304 and 416. HEAD, 304 and 416 have no body; a 304 also drops `Content-Length`. [read: BW packages/astro/src/runtime/site.ts]
- With Astro's `staticHeaders` adapter feature on, the per-page headers Astro reports (`routeToHeaders`, for example a CSP with hashes) are inlined and applied to stored pages, minus `Content-Type` so the charset survives. [read: BW packages/astro/src/build/manifest.ts] Their tests require exactly one policy, a policy on the 404 page, and none on assets. [read: BW tests/suites/csp.test.mjs]
- Pull zone requirements written to the build manifest: cookies not stripped, Smart Cache off, cache slicing off in middleware mode (it drops storage's `ETag`). Smart Cache caches only known static extensions, so it never caches HTML. [read: BW packages/astro/src/index.ts, packages/astro/README.md]

### Pitfalls and fixes in history

- **2026-10-14 (PF):** BW decided "immutable for a year" by "not HTML", so `robots.txt`, sitemaps and the service worker were cached immutable for a year. PF switched to "inside the assets directory" for immutable and the page lifetime for everything else. [read: PF history, 2026-10-14]
- **2026-10-14 (PF):** a `headers` option added to put a security baseline on every stored file; Astro's per-page headers win over it; rendered responses are untouched. Verified only with `astro preview`, not live. [read: PF history, 2026-10-14]
- BW's default page lifetime is `public, max-age=60`; PF set "revalidate every request". [read: BW packages/astro/src/index.ts; PF same commit]
- BW's README says its CLI turns the zone's cache override "off" so headers reach visitors unchanged. [read: BW packages/astro/README.md, Deploy] Our research names the needed value as -1. [read: plan docs/research/bunny.md] "Off" is ambiguous.

### Versus our plan

- Aligned: rendered default, prefix-based immutability (matches the PF fix and R-HDR-3), every response leaves with `Cache-Control`. [read: plan docs/adr/0005-always-emit-cache-control.md]
- **Gap:** our design never says who sets `Content-Type` on a standalone storage read. [read: plan docs/design.md, by absence] Our test plan's fake storage sniffs the type from the extension, which may be true for a storage-origin pull zone but not for the Storage API. [read: plan docs/testing.md]
- **Gap:** our plan does not decide whether to enable `staticHeaders`. With CSP on and `staticHeaders` on, Astro moves the policy from a meta tag into the header map. [read: plan docs/research/astro.md] R-HDR-6 needs one or the other on prerendered pages.

### Verdict: adopt, close the gaps

- Adopt: immutable-header copy, length-with-encoding rule, bodyless statuses, prefix immutability.
- **Verify first:** what the Storage API returns as `Content-Type` and `ETag`. BW contradicts itself: one comment says octet-stream for everything, its emulator comment says "the real zone does send a type". [read: BW packages/astro/src/runtime/mime.ts, packages/astro/src/build/local-zone.ts] Test: upload a `.css`, `.js`, `.svg`, `.webmanifest` and an extensionless file, GET each through the Storage API, record headers.
- **Verify first:** whether `Accept-Ranges` on a standalone response changes anything, given our research says the CDN answers ranges for GET. Test: with and without the header, request a 5 MB file with `Range` on a cold cache and a warm cache, compare status and bytes.
- **Verify first:** read the pull zone after a BW CLI deploy and record the actual `CacheControlMaxAgeOverride` value.
- Decide `staticHeaders` explicitly; test both CSP placements.

## 5. Redirects and error pages

### What they do

- Astro writes a meta-refresh page for a redirect to a prerendered route. Serving that page answers 200, and browsers ignore `Location` on a 200. [read: BW packages/astro/src/runtime/types.ts, packages/astro/src/runtime/site.ts]
- So they collect redirect routes from Astro's header map at build, inline target and status per key, and answer them in the script before storage. Status: the configured one, else 301 for GET and 308 for other methods. Redirects get the page lifetime. [read: BW packages/astro/src/build/manifest.ts, packages/astro/src/runtime/site.ts]
- Their tests cover: configured status kept, parameters filled in, a parameter with no page left alone, 308 for a body-carrying method, a redirect to another host, and `Astro.redirect()` keeping its status. [read: BW tests/suites/redirects.test.mjs]
- Error pages come through Astro's prerendered error page fetch hook, which reads `404.html` and `500.html` from storage, never by fetching itself. [read: BW packages/astro/src/runtime/site.ts]
- The 500 page is forced to no-store, because Astro reuses the fetched page's headers on the visitor response and a cached 500 hands one transient failure to everyone. The 404 keeps the page lifetime. [read: BW packages/astro/src/runtime/site.ts]
- No 404 page means a bare 404. An endpoint's own 404 stays as is, so JSON clients never get HTML. [read: BW tests/suites/errors.test.mjs, packages/astro/README.md, Troubleshooting]
- `Astro.rewrite()` to a prerendered 404 throws a 500; their advice is returning a 404 response instead. [read: BW packages/astro/README.md, Troubleshooting]

### Versus our plan

- Ours forces `build.redirects: false` for script builds so Astro renders redirects with real statuses, and routes them before storage. [read: plan docs/design.md, Build flow and decision table row 6] No table, no second copy of Astro's status rule.
- Our ADR 0005 marks error pages "rendered", so `private, no-store`. [read: plan docs/adr/0005-always-emit-cache-control.md] Whether a prerendered 404 fetched through the hook counts as rendered is not stated.

### Verdict: adapt, verify first

- **[unverified] Ours is simpler** if Astro matches redirect routes at runtime with `build.redirects: false`. **Spike:** a fixture with a static redirect, a dynamic redirect with parameters to a prerendered page, an external redirect and a configured 302; build with `build.redirects: false`; check that no meta-refresh page is written and that the script answers each with the right status for GET and POST.
- Adopt "500 never cached" as a rule and a test, whatever path produced it.
- Decide and test the cache header of a prerendered 404 served through the error hook.

## 6. Env and secrets

### What they do

- One helper reads variables from Deno's env, then `process.env`. Astro's env getter is set at module load. [read: BW packages/astro/src/runtime/site.ts]
- No secret is an option; all are read at runtime. [read: BW packages/astro/README.md, Configure the script]
- Client address: leftmost `x-forwarded-for`, then `x-real-ip`, then a loopback fallback, because `Astro.clientAddress` throws when the adapter passes nothing. [read: BW packages/astro/src/runtime/site.ts]
- A locals object exposes country, request id, client address, `waitUntil`, the Cache API and env. [read: BW packages/astro/src/runtime/types.ts]
- Variable names are deliberately shared across all future bunny adapters. [read: BW docs/writing-an-adapter.md, Configuration]

### Pitfalls and fixes in history

- **2026-10-14 (PF):** an app-level workaround that fed `.env` values into `astro:env` schema defaults inlined a read-only CMS token into the server bundle, twice. [read: PF history, 2026-10-14]

### Versus our plan

- Ours uses `x-real-ip`; our research measured that Bunny discards a visitor-sent forwarded header. [read: plan docs/research/bunny.md] Either works on Bunny; `x-real-ip` is simpler.
- Ours drops the locals object. [read: plan docs/design.md, Options]

### Verdict: adopt

- Adopt the bundle scan for secrets and make it include values that reach the bundle through `astro:env` defaults.
- Adopt a loopback fallback for client address off the network only. [guess] On the network the header is always present.

## 7. Sessions, cache provider, images

### What they do

- **Sessions** (default on in BW): one storage object per session id, the id reduced to safe characters, a separate writable zone recommended, falling back to the asset zone with a clear error on write. No expiry: `session.ttl` only governs the cookie. Session objects are never under the deploy folder, because a session outlives a deploy. [read: BW packages/astro/src/session.ts, docs/writing-an-adapter.md]
- Preview keeps local sessions outside `dist/client`, because a deploy uploads that folder and would publish them. [read: BW packages/astro/src/preview.ts]
- **Cache provider** (default on in BW): route rules become `public, max-age=0, must-revalidate` plus `s-maxage` and `stale-while-revalidate`, and a `CDN-Tag` header with a path tag. Tags are cut before 1,024 bytes, since bunny.net truncates the header and a truncated tag never matches a purge. Invalidation is one purge API call per tag, with an account API key. [read: BW packages/astro/src/cache.ts]
- Smart Cache must be off or route rules have no effect on HTML. [read: BW packages/astro/README.md, Caching and purging]
- **Images:** a no-op service by default. An optional Optimizer service writes query parameters and clamps width and height so a crafted URL cannot request a huge render. [read: BW packages/astro/src/image-service.ts]

### Pitfalls and fixes in history

- With Optimizer on, a script-backed pull zone answered 523 on every cache miss, measured on two zones in August 2026. [read: BW packages/astro/README.md, Images; packages/astro/src/types.ts]
- Their deleted plan suggested a storage-origin (middleware) zone might fix Optimizer, marked "measure it, do not claim it". [read: BW history, plans/one-command-deploys.md]
- Account-wide API key for purges is an open concern; they wanted a purge-scoped token. [read: same plan]
- PF turned sessions off; nothing uses them. [read: PF history, 2026-10-14]

### Versus our plan

- ADR 0006 defers all three. [read: plan docs/adr/0006-v1-scope-sessions-cache-images.md] Aligned.
- Whether the provider's headers survive Astro's stripping is open in our research. [read: plan docs/research/astro.md] BW's README shows them in output, but I did not see a test that checks them on Bunny. [read: BW packages/astro/README.md; tests/suites/options-off.test.mjs covers only the "off" case]
- Our plan declares the sharp image service "limited". [read: plan docs/design.md, Build flow] BW declares it unsupported and forces the no-op service. [read: BW packages/astro/src/index.ts]

### Verdict: adopt the deferral

- **Verify first (M2):** with the sharp service, build a fixture whose on-demand page uses `<Image>`; confirm sharp is not in the bundle and the bundle starts on Deno with `Bunny` stubbed.
- **Later spike:** Optimizer behind a middleware storage-origin zone, a rendered `<img>` URL with width parameters, cold cache, expect a resized image rather than 523.
- When a cache provider is built, adopt the tag-length cut and the "Smart Cache off" requirement.

## 8. Bundling and size limits

### What they do

- A second bundling pass with esbuild over Astro's server output: neutral platform, ESM, the `deno`, `worker`, `import`, `module`, `default` conditions, and `node:*` left external. The `deno` condition selects the SDK's edge build; without it a Node HTTP server enters the bundle. [read: BW packages/astro/src/build/bundle.ts, docs/writing-an-adapter.md]
- Bare built-in names (`fs`, `buffer` and about forty more) are aliased to their `node:` names in the server build, because the runtime only answers to the prefixed names. The list includes `constants` and `path/win32`. [read: BW packages/astro/src/build/bundle.ts, packages/astro/README.md, Node built-ins]
- Fail above 10 MiB; warn above 7.5 MiB. On failure, list the five packages that fill the bundle most. [read: BW packages/astro/src/build/bundle.ts]
- The server output folder is deleted after bundling, unless the output file was written inside it. [read: BW packages/astro/src/index.ts, tests/suites/outfile-nested.test.mjs]
- `node:fs` is a virtual file system: empty per cold start, private per isolate, counted against memory. [read: BW packages/astro/README.md]

### Pitfalls and fixes in history

- **Measured August 2026, standalone, Germany:** the same code served every request at 7.44 MB and answered 400 with an empty body to every request at 7.83 MB; around 7.5 MB the first request failed and later ones worked. [read: BW packages/astro/src/build/bundle.ts]
- **2026-10-14 (PF):** Shiki, pulled in by a CMS package, alone exceeds 10 MB; the site stubs it. [read: PF history, 2026-10-14]

### Versus our plan

- Our thresholds are warn at 5 MB, fail above 9 MB, from a measured 9.5 MB failure and 8 MB booting. [read: plan docs/design.md, docs/research/bunny.md] Their failure point is lower. [guess] Start cost depends on how much code runs at load, not bytes alone, so both can be true for different bundles.
- Our risks list measured `constants` and `path/win32` as breaking startup. [read: plan docs/design.md, Risks] They alias both. Contradiction.
- Our ADR 0007 keeps a seam with a post-build bundling pass as the fallback. [read: plan docs/adr/0007-bundle-seam-and-server-parts.md] Theirs shows that a post-pass works on Astro 7 today. [read: BW packages/astro/src/build/bundle.ts]

### Verdict: verify first

- **Spike (size):** one real Astro app padded with real, executed code (not a dead string) to 6.5, 7, 7.5, 8, 8.5 and 9 MB; publish each as standalone and middleware; 20 cold requests per size from three PoPs. Record first-request and steady status. Set the fail line below the lowest failing size seen.
- **Spike (builtins):** a script importing each of `constants`, `path/win32` and a bare `buffer` (no prefix); publish; record which start. Adopt aliasing only for names that start.
- Adopt the "largest contributors" report on a size failure.
- Adopt the "do not delete the folder the output lives in" guard as a test.

## 9. Build manifest and deploy

### What they do

- `.bunny/build.json` version 1, `kind` `ssr` or `static`, script entry, type and bytes, assets dir, `requires` (pull zone settings, storage write, env names with reason, secret and optional flags), dev commands. [read: BW packages/astro/src/build/deploy-manifest.ts, docs/writing-an-adapter.md]
- `buildOutput` is read in `astro:config:done` before `setAdapter()` and passed back. The `output` config field is only a default since Astro 5; reading it "deployed three real projects with every dynamic route missing". [read: BW packages/astro/src/index.ts, docs/writing-an-adapter.md]
- **A fully prerendered page with a `server:defer` island is reported by Astro as a static build**, so they add an option to force a server build. [read: BW packages/astro/src/index.ts, packages/astro/src/types.ts, packages/astro/README.md]
- A static build writes `_redirects` (with a force marker so the rule beats Astro's meta-refresh page) and `_headers` (including an immutable rule for the assets folder), for what they call the `bunny sites` router. [read: BW packages/astro/src/build/static-files.ts, packages/astro/README.md, A site with no server]

### Pitfalls and fixes in history

- **Verified 2026-08-19** on a real account: a script-origin pull zone reports `StorageZoneId: -1`, not null; a publish is not instant, so the CLI waits for the release to reach nodes and purges again (a probe cannot tell old from new, both answer 200); rollback restored the previous page and its assets in about 5 seconds; an unchanged redeploy uploaded nothing. [read: BW history, plans/one-command-deploys.md]
- **2026-10-14 (PF):** Astro resolves the adapter's runtime entrypoints by package name, so renaming the package broke a hard-coded name; PF now reads it from its own package metadata. [read: PF history, 2026-10-14]
- **2026-10-14 (PF):** a Cloudflare-style `_headers` file was deleted because "the Bunny adapter never reads" it, for a server build. [read: PF history, 2026-10-14]
- "Two adapters are the real test of the manifest" was left open. [read: BW history, plans/one-command-deploys.md]

### Versus our plan

- ADR 0003 says a site with no on-demand route, **no server islands** and no actions builds static. [read: plan docs/adr/0003-keep-static-sites-static.md] BW says Astro cannot tell a prerendered island apart. If BW is right, ADR 0003 ships a static site whose islands 404.
- Our research found `_headers` and `_redirects` nowhere in bunny.net docs. [read: plan docs/research/bunny.md] BW claims the `bunny sites` router reads them. [read: BW packages/astro/README.md] Our design lists them as a non-goal "not a bunny platform feature". [read: plan docs/design.md]

### Verdict: adapt, verify first

- **Spike (islands):** an Astro 7 project, every page prerendered, one page with a `server:defer` component; log `buildOutput` in `astro:config:done`. If it is "static", ADR 0003 needs a detection step or an override.
- **Spike (`bunny sites`):** deploy a static build with `bunny sites deploy` containing a `_redirects` rule (with and without the force marker over an existing file) and a `_headers` rule; check status, `Location` and the header. Only then reconsider the non-goal.
- Adopt: the publish-propagation fact for smoke tests, and a test that installs the packed tarball into a clean project and builds (catches entrypoint resolution by name).

## 10. Preview and dev

### What they do

- `astro preview` runs the deployed bundle itself under Deno, with a local Storage API emulator (and, for middleware, a local storage-origin emulator), and waits up to 10 seconds for the server to answer. It fails with an install hint when Deno is missing. A static build has no preview entrypoint, so Astro's static server takes over. [read: BW packages/astro/src/preview.ts, packages/astro/src/index.ts; VF packages/astro/src/preview.ts]
- The SDK's local listener requires a dotted IPv4 and throws on a name; `localhost` is mapped. An empty port variable is guarded. [read: BW packages/astro/src/runtime/site.ts]
- The emulator answers single ranges (open-ended and suffix), 416 outside the object, `If-None-Match` before `If-Modified-Since`, an `ETag` of modification time and size in hex (claimed to match the real zone), and a deliberately wrong content type so a script trusting it fails. Origin mode maps `/x` and `/x/` to `x/index.html`, measured on a storage-origin zone on 2026-09-30. [read: BW packages/astro/src/build/local-zone.ts; VF same file]
- `cdn-` headers are absent locally. [read: BW packages/astro/README.md, Local development]

### Versus our plan

- Our M5 preview is a Node server running `decide` against `dist/client`. [read: plan docs/plan.md, M5] It does not run the artifact we ship.

### Verdict: verify first

- [guess] Their approach catches bundle-only failures (conditions, builtins) in preview; ours avoids a Deno dependency for users. Our test suite already runs the bundle under Deno. [read: plan docs/testing.md]
- **Test:** take one known bundle-only failure (a dependency resolved through the wrong export condition) and check which of the two previews shows it. Choose with that result.
- Do not copy the emulator's `ETag` shape or multi-range claim without the Storage API check in section 4.

## 11. Testing approach

### What they do

- Four tiers: unit tests for pure helpers; one showcase site where each capability is one page and one check; one small fixture project per configuration; a live tier run by hand. [read: BW docs/writing-an-adapter.md, CLAUDE.md]
- Tests run the bundle on Deno, not Node. [read: BW CLAUDE.md]
- The storage emulator records every path asked for, so a test proves where the script looked, not only what came back. [read: BW CLAUDE.md, packages/astro/src/build/local-zone.ts]
- The showcase checks were rerun against a middleware build on 2026-09-30, because a fixture only covers the cases it was written for. [read: VF commit "Run the showcase checks against a middleware build too"]
- Live tier: finds the pull zone from a response header, adds a unique query token per request to miss the cache, waits 45 seconds for a zone change to settle, reads a paid setting first and restores it at the end, including on Ctrl-C. [read: BW tests/live.mjs, tests/optimizer.mjs]

### Versus our plan

- Very close to our layers. Ours adds a pure decision table that needs no Astro build. [read: plan docs/testing.md]

### Verdict: adopt

- Adopt the request log assertion, the per-script-type rerun of the full HTTP check list, and the live tier's cache-busting token, settle wait and setting restore.

## Contradictions inside the prior art

Each of these needs a measurement before anyone relies on either side.

- Storage API content type: "octet-stream for everything" versus "the real zone does send a type". [read: BW packages/astro/src/runtime/mime.ts, packages/astro/src/build/local-zone.ts]
- File list threshold: 5,000 in code, 20,000 in docs. [read: BW packages/astro/src/index.ts, packages/astro/README.md]
- Size: 10 MiB documented limit, 7.83 MB measured failure. [read: BW packages/astro/src/build/bundle.ts] Our own research: 8 MB booted. [read: plan docs/research/bunny.md]
- Cache override: "turned off" in BW's README versus -1 in our research. [read: BW packages/astro/README.md; plan docs/research/bunny.md]
- Builtins `constants` and `path/win32`: aliased by BW, measured as breaking startup in our prototype. [read: BW packages/astro/src/build/bundle.ts; plan docs/design.md]

## Edge cases for the new test suite

Phrased as behavior. Each should run against both script types unless marked.

### Routing

- A request for a file written by an integration after the adapter's build hook (a sitemap index, a service worker) under a catch-all on-demand route returns the file with 200.
- A path that matches a dynamic on-demand route and has no stored file renders the route, with Astro seeing the visitor's original path and query.
- A request causes at most one storage read; a path the build cannot hold causes none where the decision allows it.
- With `base: "/docs"`, `/docsx/page` is outside the base.
- With `base` set, the site root, a page, an asset, a `public/` file and an endpoint all answer under the base.
- With `build.format: "file"`, `/about` and `/about/` both return `about.html` with an HTML content type and charset, in both script types.
- An extensionless public file (such as `/CNAME`) behaves as documented (our ADR 0002 says not found).
- A HEAD for a stored file returns its headers, including length, and no body.
- A HEAD for a rendered route returns headers and no body.
- A POST to a stored file's path does not return the file's bytes.
- A POST to an unknown path returns the site's 404 page or Astro's 404.
- A method a route does not export returns Astro's answer for it.
- The query string reaches Astro byte for byte.
- `/deploys/<id>/...` requested by a visitor returns 404 and never reads another deploy's files.

### Path safety

- An encoded `..` pair, a raw `..`, a backslash traversal, a double-encoded traversal and a malformed escape each produce a storage request inside the deploy folder, or none (assert on the storage request log).
- A key containing `?` or `#` after decoding is requested as a literal file name.
- A request never reaches a sibling folder of the deploy folder in the zone.

### Headers and caching

- Every response leaves with `Cache-Control`, including the adapter's own 500, a storage 401, 403 or 5xx passed through the origin hook, a redirect built with `Response.redirect()`, and an external redirect.
- A rendered response with immutable headers still gets the default header without throwing.
- Files under the assets folder get the immutable lifetime; `robots.txt`, a sitemap and a service worker do not.
- A stored `.css`, `.js`, `.mjs`, `.svg`, `.webmanifest`, `.woff2` and `.wasm` each get the right content type in standalone mode.
- A stored page's `Content-Type` keeps its charset even when Astro reports a plain `text/html`.
- A stored response with `Content-Encoding` carries no stale `Content-Length`.
- A conditional GET with a matching `If-None-Match` returns 304 with no body and no `Content-Length`.
- A `Range` request returns 206 with the requested bytes (from the middle, open-ended, suffix); an unsatisfiable one returns 416; an unparseable one returns the whole file (standalone; record middleware behavior live).
- A prerendered page with a CSP carries exactly one policy, the 404 page carries it, and assets do not.
- Consumer headers appear on stored files and never replace a header a rendered response set.
- A rendered response with `Set-Cookie` and a shared-cacheable `Cache-Control` follows the rule the team decides (ADR 0005 open question).
- Two cookies set by a route leave as two `Set-Cookie` headers with attributes intact; a header set twice by a route leaves twice.

### Redirects and errors

- A configured redirect to a prerendered page returns its configured status with `Location`, not a 200 meta-refresh page.
- A redirect with no configured status returns 301 for GET and 308 for POST.
- A dynamic redirect fills its parameters; a parameter with no matching page is left untouched.
- A redirect to another host works.
- `Astro.redirect()` keeps its status.
- A page that throws returns the prerendered 500 page with status 500, never cacheable; the next request still works.
- An endpoint that throws returns status 500.
- A project with no 404 page returns a bare 404; an endpoint's own 404 body is kept.
- A rewrite from an on-demand page to a 404 keeps status 404 (and document what happens with a prerendered 404 target).

### Runtime

- `Astro.clientAddress` is the `x-real-ip` value on Bunny, and something defined off the network; a visitor-sent forwarded header does not change it (live).
- A POST form from the site passes Astro's origin check in middleware mode, where `request.url` is the storage origin.
- A streamed response arrives in pieces, not buffered (local; confirm live in S1).
- A large text body and a binary request body reach the route unchanged.
- An `astro:env` secret declared in the schema is read at runtime and its value appears nowhere in the bundle or the manifest, including through schema defaults.
- A missing deploy global answers 500 with a log line naming the cause, and no storage read happens.
- A refused storage password logs once per isolate, not per request.

### Build

- A fully prerendered project builds no script and writes `kind: "static"`.
- A fully prerendered project with one `server:defer` island still serves the island (outcome depends on the islands spike).
- A project with one on-demand page and prerendered pages serves the prerendered page from storage and renders the on-demand page on every request.
- An output file placed inside the server output folder is kept.
- An oversize bundle fails the build and names the largest packages.
- The adapter installed from its packed tarball into a clean project builds and serves.
- The bundle imported alone under Deno, with `Bunny` stubbed, starts without errors.
- A dependency importing a bare built-in name starts on Bunny (after the builtins spike decides the rule).
- An on-demand page using `<Image>` with the sharp service does not pull sharp into the bundle.
- i18n: a page per locale is served from storage, a locale page without trailing slash is served, an unknown locale returns 404, the bare root follows Astro's decision.
- Content collections read inside the script return entries in the order requested; a missing entry returns 404.
- An action answers JSON, rejects invalid input, handles a form POST, and its response carries a deliberate `Cache-Control`.
