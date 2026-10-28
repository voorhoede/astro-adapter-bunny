# Prior art: the prototype

What an earlier prototype by the same author learned about running framework server code on bunny.net, read on 2026-10-28 by a reviewer outside the clean room. The prototype is an edge platform that runs on bunny.net, with its own adapters for Astro and other frameworks. This report describes behavior, measurements and pitfalls only; it contains no code from it. Implementers read this report, never the prototype.

The user's rule applies throughout: nothing here is true for us until we verify it. Where something looks better than our plan, there is a verification step to run before adopting it.

## How to read this

- **[read]**: seen in the prototype's source, tests, docs or git history. Says what the prototype does, not that it works on Bunny today.
- **[measured, date]**: from the prototype's dated spike notes on Bunny. Says what was observed once, on that date, on throwaway resources.
- **[guess]**: the reviewer's inference. Not checked anywhere.
- "Our plan" means `docs/design.md`, `docs/plan.md`, `docs/testing.md` and `docs/adr/0001` to `0007` as of 2026-10-28.
- The prototype's measured site is called "a content site with code highlighting" below. It is an Astro site whose server bundle is dominated by a syntax highlighter.

### The one structural difference to keep in mind

- The prototype is a platform: one loader script per zone serves many deployments, reads a per-deployment record with a full file table, and fetches all server code from storage at request time [read].
- Our adapter is one script per release with no file table, where server code lives in the script plus parts in the deploy folder.
- So its routing and static lookup lessons transfer only partly. Its module loading, Bunny limits and caching lessons transfer almost fully.

## Verdict overview

| Topic | Verdict |
| --- | --- |
| Build output shape | adapt |
| Astro integration hooks and Astro 7 specifics | adopt two items, verify first on two |
| Routing and static-first lookup | keep our plan; adopt its edge cases |
| Headers, redirects, `_headers` and `_redirects` | avoid the files; adopt the CSP-as-header mechanism after verifying |
| Caching | adopt its zone settings and its `Vary` rule |
| Env and secrets | adopt its limits as checks and docs |
| Images | adopt the build and runtime split |
| Sessions | agree with our plan |
| Server code splitting and packing | adapt: packs or equivalent are needed without a size threshold |
| Module loading and integrity | verify first; the prototype did not hash-check parts |
| Cold start and isolate lifetime | adopt its numbers as baselines, re-measure |
| Testing and e2e | adopt the approach; ours already matches most of it |

## Build output shape

What it does:

- After the framework build, it re-bundles the framework's server entry with a second bundler pass into ES modules split at `import()` boundaries, minified, with a fixed list of export conditions that prefer edge and worker builds of packages [read].
- Only a fixed allowlist of Node builtins may remain as imports; anything else fails the build with the importing module named [read].
- A CommonJS `require()` of a builtin inside the ES module output is rewritten to go through an ES import of that builtin, because ES modules have no `require` [read].
- A `.wasm` import becomes a compiled `WebAssembly.Module` with its bytes inlined, matching how worker-targeted packages expect to receive it [read]. This was a bug fix, added after a package failed [read].
- `process.env.NODE_ENV` is fixed to production at build [read].
- A separate conversion step turns those ES modules into `System.register` format with Rollup, one output module per input module, tree shaking off, and every import that is neither a sibling module nor an allowed builtin fails the deploy, naming it [read]. Converting 448 modules of the content site took 0.9 s [measured, 2026-10-17].

Problem it solved: Bunny refuses `import()` in every form, so code must arrive as one module or through a loader [measured, 2026-08 and re-stated 2026-10-16].

Where it differs from our plan:

- Our plan has Vite or Rolldown emit the final shape directly, with Rollup as a fallback over split ES modules (ADR 0007, S2).
- The prototype's two-stage path (split ES modules first, then convert to `System.register`) is the one with evidence behind it.

Verdict: **adapt.** Keep `build/bundle` as the seam; inside it, the two-stage path is the fallback with a track record.

Verify first:

- Build the test app's `/code` page and check whether Vite 8 output can be fed to Rollup's `system` format with no second bundler. Pass: every `import()` target is its own file, and no file imports a bare package name.
- Grep the server output for `require(` of a builtin and for `.wasm` imports. Each one needs a decision before it reaches Bunny.

## Astro integration hooks and Astro 7 specifics

What it does:

- Requires Astro 7.4, because 7.4 split the image service into a build service and a runtime service [read].
- Declares `staticHeaders: true` and collects `routeToHeaders` in `astro:build:generated`, so the headers Astro computes for prerendered pages (the CSP of `security.csp`) are served as HTTP headers on stored files [read]. Its example checks that a prerendered page carries a `content-security-policy` header [read].
- Declares `preserveBuildClientDir` and `preserveBuildServerDir`, `entrypointResolution: auto`, `envGetSecret: stable`, `i18nDomains: experimental`, and `sharpImageService` as limited with a message [read].
- Registers a second integration of its own from `astro:config:setup`, so that its `astro:build:done` runs after the integrations the site lists (sitemap and similar), and the output includes files they wrote [read]. The ordering claim is in a source comment, not in a test [read].
- Treats a site as needing a server when any non-internal page or endpoint renders on demand, or when any prerendered HTML file references the server islands path. It does this because Astro always adds its internal routes for islands and images, used or not [read].
- Captures the middleware entry from `astro:build:ssr` for an optional mode that runs Astro middleware before stored files too [read].
- Passes `prerenderedErrorPageFetch` reading the error page from the deployment's own files, never fetching itself over the network [read].

Where it differs from our plan:

- Our plan never mentions `staticHeaders` or `routeToHeaders`. R-HDR-6 says the CSP on rendered pages passes untouched, but says nothing about how prerendered pages get theirs as a header [guess: under our plan, prerendered pages keep the CSP as a meta tag, which is weaker for some directives].
- ADR 0003 says a site with "no server islands" builds static. It does not say how islands on prerendered pages are detected.

Verdict: **adopt** the 7.4 requirement and `prerenderedErrorPageFetch` through storage (both already in our plan). **Verify first** on `staticHeaders` and island detection.

Verify first:

- Build the test app with `security.csp` and `staticHeaders: true`, and check what lands in `routeToHeaders` and whether the HTML still carries the meta tag. Decide whether `caching.finalize` adds these headers for stored files, which means build-time per-path header data in the script.
- Build a fixture where every page is prerendered but one uses `server:defer`. Check whether Astro's `buildOutput` in `astro:config:done` already says `server`. If it does not, our static detection is wrong for that case.

## Routing and static-first lookup

What it does:

- The platform holds a file table per deployment, so "is there a file" is a memory lookup and a miss never costs a storage request [read].
- The Astro adapter maps all on-demand rendering to one route type meaning "file if present, else server", plus fixed server-only prefixes for actions, server islands and the image endpoint [read].
- `trailingSlash` maps to three HTML lookup modes. In the strict modes, a request for a file's own name (`/about/index.html`, `/blog.html`) answers 308 to its URL form, query kept [read].
- With a `base`, the root of the hostname answers 307 to the base, and the base without its trailing slash answers 308 to it so relative links resolve; other paths outside the base get the not-found response [read].
- Paths are percent-decoded once, `.` and `..` segments refused, repeated slashes collapsed [read]. On Bunny, a raw `..` in the URL arrives already normalized, so the refusal never fires there [measured, 2026-10-16].
- The visitor host comes from `cdn-host`, which Bunny overwrites; `x-forwarded-host` is passed through from the client unchanged [measured, 2026-10-16].
- In a middleware script, `request.url` is the storage origin's URL, not the visitor's [measured, 2026-10-16].

Where it differs from our plan:

- Our plan asks storage first, with no file table (ADR 0002). That costs one storage miss per catch-all render. The prototype's design avoids that cost and needed a deploy step that writes the table.
- Our plan answers 404 for paths outside `base`. The prototype redirects the root to the base.

Verdict: **keep our plan** for lookup. **Adopt** its edge cases (see the last section). The root-to-base redirect is a product choice; Astro's own behavior should decide it, not the prototype.

Verify first:

- Run `astro preview` with the Node adapter on the `routing` fixture with `base: '/docs'` and record what `/`, `/docs` and `/docs/` answer. Match that.

## Headers, redirects, `_headers` and `_redirects`

What it does:

- Reads `_headers` and `_redirects` in the common Netlify and Cloudflare syntax, translates them into its manifest, and never serves the files [read]. Rewrites (status 200), query conditions, country conditions and forced rules are refused with a warning [read].
- Refuses a fixed set of headers in header rules: `set-cookie`, `cache-control`, `cdn-cache-control`, `content-length`, `content-encoding`, `transfer-encoding`, `connection`, and anything starting with `cdn-` [read]. A `content-type` in header rules wins over the stored one [read].
- Translates Astro config redirects into platform redirects where the pattern allows it, and leaves the rest to Astro's server with a build warning [read]. Its checks require the visitor's query string to be appended to the redirect target unless the target has one [read].

Where it differs from our plan:

- Our plan has no `_headers` and `_redirects` support and forces `build.redirects: false` so Astro answers redirects with real status codes.
- Our `headers` option never overwrites, and is applied after the cache rules so it cannot set `Cache-Control` (ADR 0005). The prototype gets the same effect by refusing the header outright.

Verdict: **avoid** `_headers` and `_redirects` in v1; they are a platform feature there, and our non-goal is right. **Adopt** the refused-header list as a build-time error on our `headers` option: today ours silently skips `Cache-Control`, which hides a user mistake [guess].

Verify first:

- Check whether Astro's own redirect response keeps the visitor's query string. If not, decide whether we append it; the prototype's checks assume it is kept.

## Caching

What it does and found:

- A storage-origin pull zone created with defaults overrides `cache-control` with 30 days, ignores the query string in the cache key and strips cookies. Server responses marked `no-store` came back as `public, max-age=2592000` with `CDN-Cache: HIT` [measured, 2026-10-16]. With `CacheControlMaxAgeOverride: -1`, `IgnoreQueryStrings: false`, `DisableCookies: false` and a purge, middleware responses were cached under their own `cache-control` [measured, 2026-10-16].
- A server response without `cache-control`, with `set-cookie`, or with a `Vary` other than `accept-encoding` is stored as `no-store` [read]. The `Vary` rule exists because the zone ignores `Vary` [read, stated as verified in its notes].
- Its Astro cache provider emits `public, max-age=0, s-maxage=<n>` plus `stale-while-revalidate`, so browsers always revalidate and only the edge caches [read]. Invalidation by tag or path throws, since the platform purges everything on deploy [read].
- Stored files get their content hash as `etag` and a 304 on a matching `If-None-Match`; hashed assets get a year, immutable [read].
- A middleware rewrite does not change the cache key; the key is the visitor's URL [measured, 2026-10-16].
- A purge by `CDN-Tag` set by a middleware worked within 5 s at 18 PoPs in two of three rounds; in one round one PoP kept the old version for over three minutes, and only a full zone purge cleared it [measured, 2026-10-16].
- Middleware does not run on a cache hit [measured, 2026-10-16].

Where it differs from our plan:

- ADR 0005 has no `Vary` rule. A rendered response with `Vary: cookie` and a shared-cacheable `Cache-Control` would be cached once and served to everyone [guess, based on the zone ignoring `Vary`].
- ADR 0005 forces `private, no-store` with `Set-Cookie` as an open question. The prototype does it without exception.

Verdict: **adopt** the three zone settings as documented deploy requirements (ours already lists them), the `Set-Cookie` rule, and a `Vary` rule. **Avoid** relying on tag purges for a future cache provider without a repeat-and-check step.

Verify first:

- Live: a rendered page answering `Vary: cookie` with `public, s-maxage=60`, requested with two different cookies. If the second gets the first's body from cache, add the `Vary` rule to `finalize`.

## Env and secrets

Measured on Bunny [measured, 2026-10-16]:

- Secrets are read through `Deno.env.get` like variables.
- A changed variable or secret never reaches a running isolate. Only isolates started after the change see it; PoPs flapped between old and new for over two minutes.
- At most 4,096 characters per value; the API refuses more.
- With 128 variables the script works; with 129 every request answers 400. The API accepts the 129th without error. Secrets do not count toward the 128.
- Around 242 to 254 KB of total values, every request answers 431 [measured, 2026-10-16]; the exact limit is a guess at 256 KB [guess, as the prototype itself marks it].

What it does:

- Calls `setGetEnv` with the process environment, and gives each deployment its own `process.env` snapshot [read].

Where it differs from our plan:

- Our rollback run expects `/env` to read the current variables after a republish (R-ENV-5). Given the isolate finding, that check passes only on a fresh isolate [guess].

Verdict: **adopt** the limits. List them in the README, and have `requires.env` in the manifest warn when an app declares more than 128 `astro:env` server variables.

Verify first:

- In the live rollback run, read the variable through a request that also prints an isolate id, and accept the old value only from an isolate older than the change.

## Images

What it does:

- When the configured image service is Sharp, it keeps Sharp as the build service and sets the runtime service to Astro's no-op service, using the 7.4 split [read].
- Its example checks that a prerendered image is optimized at build, and that an on-demand page's image URL under `/_image` answers 200 with an image content type, untransformed [read].

Where it differs from our plan: ADR 0006 states the outcome (`sharpImageService: limited`) but not the mechanism.

Verdict: **adopt** the mechanism.

Verify first: build the test app with the default Sharp service and grep the server output for `sharp`. Pass: absent. Then request an `/_image` URL from an on-demand page locally on Deno.

## Sessions

What it does: no default driver; allows an in-memory per-isolate driver for trying things out only [read].

Why that matters here: isolates are almost never reused at low traffic (see cold start), so an in-memory session is lost between most page views of different visits [measured, 2026-10-16, applied by inference].

Verdict: **agree** with ADR 0006. Add one README line that a per-isolate memory driver loses sessions on Bunny.

## Server code splitting and packing

What it does:

- Splits at the framework's own `import()` boundaries, not per route [read]. The content site's 10.7 MB bundle had 467 KB in 29 files reachable through static imports from the entry; the rest sat behind 331 dynamic-import targets with a median of 17 KB, a 90th percentile of 339 KB and a largest of 3.2 MB [measured, 2026-10-17]. The Astro test fixture was 157 KB eager of 308 KB [measured, 2026-10-17].
- Groups modules into **packs**, each one storage object fetched in one subrequest [read]:
  - an eager pack: the entry's static closure;
  - one pack per `import()` target: its static closure minus what is eager;
  - a lazy target whose closure is under 32 KB joins the eager pack, up to 512 KB extra in total;
  - a lazy target's own small lazy targets join its pack, up to 256 KB extra;
  - a module of at least 32 KB reached by two or more lazy targets moves into a shared pack, fetched in parallel alongside, at most four shared packs per target [read].
- A module present in several packs is evaluated once per isolate [read].

Problem it solved:

- Before small parts joined the eager pack, a request fetched up to four packs one after another, most under 32 KB, and each cold storage fetch cost more than those bytes would in the eager pack [read, commit message]. After it, the home page went from three sequential fetches to one [measured, 2026-10-17].
- Before shared packs, all packs together held 51 MB for a 10.7 MB bundle, because shared modules were copied into every pack that reached them [measured, 2026-10-17]. The size after shared packs was not recorded [read: absent].

Results [measured, 2026-10-17, 15 PoPs, six rounds 45 s apart, fresh query per request]:

| Route | One module, median and p90 | In parts, median and p90 |
| --- | --- | --- |
| Home (a redirect from server code) | 899 ms, 1,385 ms | 650 ms, 950 ms |
| An API route | 934 ms, 1,406 ms | 617 ms, 963 ms |
| A missing page (server 404 reading a headless CMS) | 955 ms, 1,509 ms | 682 ms, 1,123 ms |

- About 30% off median and p90. The eager pack was 343 KB; the home page fetched only it; the 404 page fetched three packs totaling 808 KB [measured, 2026-10-17].
- These numbers include the prototype's platform overhead (record read, variable snapshot) and fetching all code, eager included, from storage [read]. They are not a prediction for our script, where eager code sits in the script [guess].

### What "always split, no size threshold" means, given this

- **Every Astro page is an `import()` target.** Astro's server entry loads pages lazily [guess, from the 331 targets of a content site; verify on our build]. So under "always split", almost every cold request needs at least one part fetch before it can render, even for a small app.
- **Without grouping, a request can exceed the subrequest limit.** The content site's code was 448 modules [measured, 2026-10-17]. One file per module with `depcache` preloading means one subrequest per module in a request's closure, against a limit of 50 per request shared with the app's own `fetch` and our storage lookups [read: limit from Bunny docs]. A page using the highlighter can reach far more than 50 modules [guess].
- **Without merging small parts, latency stacks.** Each nesting level of `import()` is a sequential round trip unless its part was prefetched. The prototype measured that removing these serial fetches was worth more than the bytes saved [measured, 2026-10-17].
- **So a size threshold disappears for splitting but reappears for grouping.** Small parts must travel with whatever reaches them, and the eager code should absorb small lazy targets. Without that, "always split" is slower than one module for small apps [guess; the prototype never measured a small app split versus whole].
- **Rollup's own chunking may do most of this.** Rollup without one-file-per-module output already makes one chunk per dynamic target plus shared chunks, and has a minimum chunk size option that merges small chunks [guess: from general Rollup knowledge, not seen in the prototype]. That may replace hand-written packing.

Verdict: **adapt.** Our ADR 0007 asks in S2 whether packs or `depcache` are needed. The prototype's evidence says grouping is needed; the open question is only whether Rollup chunking gives it for free.

Verify first (add to S2):

- Build the test app with `/code` into `System.register` output twice: one file per module, and Rollup chunking with a minimum chunk size. For each route, count the files reachable from the route's entry, static and dynamic. Pass: no route reaches more than about 10 files [guess at a budget that leaves room in 50].
- On Bunny, from at least five PoPs after 30 minutes idle, measure first byte on `/env` (small) and `/code` with: parts as many small files with `depcache`, and parts as grouped chunks. Use fresh query strings so every request is a cache miss.
- Measure a small app twice: everything in the script, and pages split out. If split is slower by more than a fixed margin agreed beforehand, small lazy targets must be inlined into the script.

## Module loading and integrity checks

What it does:

- Fetches all server code at request time, never at script startup [read]. Code fetched at request time is not bound by the 500 ms startup limit: an 18 MB bundle took over a second on its first request and answered 200 [measured, 2026-10-16].
- Evaluates fetched code with `new AsyncFunction` (and earlier `new Function`) [read]. Evaluation worked up to 17.9 MB [measured, 2026-10-16]. Parsing cost about 30 ms per MB on top of the fetch [measured, 2026-10-16].
- Uses its own `System.register` runtime, not SystemJS, because each deployment needed its own module registry and its own `process` inside one shared isolate [read].
- Reads code objects **through its own pull zone**, not the Storage API, with an internal token header; the middleware passes requests carrying that token straight to storage, and an edge rule blocks the code paths for any request without it [read]. Because of that, a second cold isolate at the same PoP got the code as a CDN cache hit: cold first byte fell to 133 to 990 ms for a 3 MB bundle [measured, 2026-10-16].
- Names code objects by content hash, so a redeploy reuses them and nothing is ever overwritten [read].
- **Does not verify a hash when loading a part.** It reads the object by its hash name and evaluates it [read]. Its `crypto.subtle` capture at startup is used for access checks and decrypting variables, not for code [read].
- Captures `fetch`, `Response`, `Request`, `URL`, `Headers.prototype.get` and `crypto.subtle` methods at startup, before any app code runs [read]. App code that patched those globals did not change the captured references, while a naive check calling the globals at request time was bypassed for every later visitor of that isolate [measured, 2026-10-16].
- A failed part fetch used to be remembered forever, so one network error made that part fail for the life of the isolate; fixed so the next import fetches again [read, fixed 2026-10-28].
- Concurrent requests that import the same part get one fetch, and every module is linked before any of it runs, so a second request never sees a module whose imports are not yet bound [read, pinned by tests].
- A module that throws while evaluating fails the import with an error naming the module; the server routes answer 500 and stored files keep working [read].
- An `import()` with a computed specifier is a build warning; at runtime it works only when it names a known module [read].

Where it differs from our plan:

- ADR 0007 says the hash check uses `crypto.subtle` "captured at startup before any app code runs (verified in the prototype)". What was verified is that captured references survive patching. **Hashing parts before evaluation was never built or measured there.** The cost of SHA-256 over a multi-MB part on Bunny is unknown.
- ADR 0007 plans reading parts "from storage under `assetPrefix`". In middleware, the obvious way is a fetch through our own pull zone. That fetch re-enters our own `onOriginRequest`, where `routing` answers "not found" for the reserved prefix (decision table row 3) [guess]. The prototype solved re-entry with a secret token header. Our plan has no such bypass.
- In standalone, parts would come from the Storage API at the main region. Static misses there took about 420 ms from New York against 85 ms through replicas (our research). Every part fetch in a cold isolate would pay that [guess].
- SystemJS's behavior after a failed fetch is unknown to this review. If it caches the failure, we inherit the prototype's bug [guess].

Verdict: **verify first** on all of these before M7.

Verify first (add to S2):

- Re-entry: in middleware, fetch a part through the zone's own hostname and log whether `onOriginRequest` runs for it. If it does, choose between a secret header the script checks before `routing` (and the edge rule exempting it), or the Storage API with the read-only key.
- Caching of parts: fetch the same part from two fresh isolates at one PoP. Pass: the second sees `CDN-Cache: HIT`.
- Standalone: measure part fetch time from five PoPs via the Storage API, and via a pull zone if standalone can reach one.
- Hash cost: time SHA-256 over 0.5, 3 and 10 MB in a Bunny isolate. Decide the check from the number.
- SystemJS failure: make the fetch hook fail once for a part, then import it again in the same isolate. Pass: the second import fetches again and succeeds.
- SystemJS concurrency: start two imports of the same part from two concurrent requests. Pass: one fetch, both render.

## Cold start and isolate lifetime

Measured on Bunny:

- A static file from storage on a cold path: p50 about 40 ms from ten cities [measured, 2026-10-16].
- A cold server route: 300 to 550 ms for a fetched 3 MB bundle, 400 to 1,000 ms for 9 MB, over 1 s for 18 MB [measured, 2026-10-16]. Fetch dominated above 5 MB; parse grew about 30 ms per MB [measured, 2026-10-16].
- Embedding a 5.1 MB bundle in the script started in 172 to 460 ms and answered no faster than fetching it (470 to 1,071 ms against 379 to 728 ms) [measured, 2026-10-16].
- Publish accepted scripts up to 15.5 MB and refused 16.7 MB and above, regardless of compressibility; the accepted 15.5 MB script then answered every request with 400 after 4 to 20 s [measured, 2026-10-16]. Our research has a 9.5 MB failure from a different run. Both may be true; the limit is about whether the script runs, not whether publish accepts it [guess].
- Isolate reuse with a new connection per request, one edge server: 10% at one request per second, about zero at 20 s and beyond, zero in 1,368 requests over three hours at 1, 5 and 15 minute intervals [measured, 2026-10-16].
- On a kept-alive connection or in a burst, requests do reuse the isolate; isolates are separate per hostname, one sample [measured, 2026-10-16].
- Statically importing 23 Node builtins starts fine; `constants` or `path/win32` alone make every request answer 400; 23 plus ten more together answered 400 while each group of five extra passed [measured, 2026-10-16]. The prototype's guess is the startup limit [guess, its own].
- `Worker` exists but constructing one fails the request with 502; dynamic `import("node:vm")` too; no `ShadowRealm` [measured, 2026-10-16].
- A hanging middleware answers 504 after 59 s; a throwing one answers 500 [measured, 2026-09, reported second-hand in its fact sheet].

What it means for us:

- At low traffic, nearly every first page view of a visit is cold, so first-use part fetches are the normal case, not the edge case [measured, applied by inference].
- Every builtin the script imports at startup costs every cold isolate. Under "always split", the script should import only what the eager code needs [guess].

Verdict: **adopt** these as baselines in `docs/measurements/`, labeled as the prototype's, and re-measure with our build. Our testing doc already plans the same ten cities.

## Testing and e2e approach

What it does:

- A written semantics spec with a numbered table of request, setup and expected result, where each row is a conformance test [read].
- Example apps per framework, each with one check file that runs against the build served locally through the platform's own loader on Deno, and against a live URL with a flag, unchanged [read]. CI runs the examples locally only; live is manual [read].
- A live harness on Bunny that provisions zones, uploads fixtures, runs the same checks twice, and deletes everything; it found three zone settings that local tests could not [measured, 2026-10-16].
- A check that needs two requests in one isolate retries until three consecutive requests report the same isolate id; that happened within ten attempts [measured, 2026-10-16].
- A local preview server that serves the build output exactly as production would, also used for `astro preview` [read].

Pitfalls it hit:

- A new storage zone answered 401 to uploads with its own password for a few seconds [measured, 2026-10-16].
- A shell passing a quoted header as one argument sent no cookie, which first looked like the middleware never receiving cookies [measured, 2026-10-16].
- A Node polyfill constructed a terminal stream at import time and failed locally whenever stdout was not a terminal [read].
- A storage file that is overwritten stays stale at replicas for 90 minutes to days [measured, 2026-09, reported second-hand in its fact sheet]. New files replicate with a p50 of 0.5 s and a max of 17 s, and are served from another region until then [measured, 2026-10-16].
- Edge rules match the visitor's path, not a middleware-rewritten path, so a block rule does not stop the script's own rewrite [measured, 2026-10-16].

Where it differs from our plan: almost nowhere. Our "one check file, four targets" and pull zone emulator match its shape. It used Vitest; we chose `node:test`, which is fine.

Verdict: **adopt** the isolate-id retry pattern for any check that needs a warm isolate, and the rule that a part path or deploy file is never overwritten.

## Edge cases for our test suite

Phrased as behavior. Each is a candidate row for `docs/testing.md`; the layer is a suggestion.

Routing and redirects:

- A config redirect keeps the visitor's query string on the target, unless the target has its own (L).
- A redirect with a parameter carries the parameter into the target (L).
- Under `trailingSlash: 'always'`, a request for `/about/index.html` either serves the page or redirects to `/about/`, as Astro's own preview does; pick one and pin it (U).
- Under `base: '/docs'`, `/docs` without a slash answers what Astro's preview answers, and `/` answers what Astro's preview answers (U, L).
- A double slash in the path resolves like a single one (U).
- A path that arrives with `..` segments is never mapped outside the deploy prefix, even when constructed locally without normalizing (U).
- A spoofed `x-forwarded-host` never changes the URL Astro sees; a spoofed `cdn-host` is overwritten by Bunny (U, Live).

Headers and caching:

- A rendered response with `Set-Cookie` and `public, s-maxage=60` is never a `CDN-Cache` HIT (L, Live).
- A rendered response with `Vary: cookie` and a shared-cacheable header is never served from cache to a different cookie (Live).
- A prerendered page carries the CSP header Astro computed for it, if we adopt `staticHeaders` (B, L).
- A stored file answers 304 to a matching `If-None-Match` (Live, R-HDR-8).
- The `headers` option given `Cache-Control` or `Set-Cookie` fails the build or warns (U).

Env:

- A variable changed on the script is not visible in a request served by an isolate older than the change (Live, informational).
- An app declaring more than 128 runtime variables gets a build warning (B).

Server parts, from M7:

- A route whose only server code is eager renders with zero part fetches in a cold isolate (L, counted by the harness).
- The first request to `/code` in a cold isolate fetches a bounded number of parts, under a budget set before measuring (L).
- Two concurrent first requests to the same page fetch each part once and both render (L).
- A part whose first fetch fails is fetched again by the next request, which renders (L).
- A part whose bytes do not match its recorded hash fails closed with 500, and stored files keep serving (L).
- A module in a part that throws at evaluation gives Astro's 500 handling or ours, never Bunny's empty 500, and the error log names the part (L).
- A visitor requesting a part path directly gets 404 in both script types, also when Bunny's edge rules are absent (L, Live).
- The script fetching its own part through the zone is not answered 404 by its own routing (Live).
- A part path is never overwritten by a later deploy; each deploy's parts live under its own prefix (B).
- A rollback to a previous release loads that release's parts, not the newer ones (Live).
- A computed `import()` specifier in app code produces a build warning (B).
- The server output imports no builtin outside the verified list, including through `require()` inside a dependency (B).
- A dependency with a `.wasm` import either builds into a working part or fails the build with the module named (B).
- A part loaded in one request is reused by a later request in the same isolate without another fetch (L).

Images and islands:

- With the default Sharp service, the server output contains no Sharp code, and an `/_image` URL on an on-demand page answers 200 with the original image (B, L).
- A fully prerendered site with one `server:defer` island still gets a script, and the island URL answers 200 (B, L).

## Summary of lessons and disagreements

1. Always splitting moves the size limit to a different place. Each Astro page is likely its own `import()` target, so almost every cold request needs a part fetch. Small parts must be merged into what reaches them, or a small app gets slower than one module. Verify by measuring a small app split and whole on Bunny.
2. Grouping parts is needed, not optional. 448 modules in a 10.7 MB site against 50 subrequests per request rules out one file per module. Check whether Rollup's own chunking with a minimum chunk size is enough before writing a packer.
3. The prototype never hash-checked parts. ADR 0007's "verified in the prototype" covers captured `crypto.subtle` references, not hashing code. Measure SHA-256 cost on Bunny before committing to it.
4. Fetching parts through our own pull zone likely re-enters our own middleware, where `routing` answers 404 for the reserved prefix. The prototype needed a secret bypass header. Our plan has no answer yet.
5. Parts fetched through the zone get CDN-cached per PoP, which roughly halved the next cold isolate's cost in the prototype. Standalone parts from the main-region Storage API would not get that. The cost of split code differs by script type.
6. A failed part fetch must not be cached for the life of the isolate. The prototype shipped that bug and fixed it on 2026-10-28. SystemJS's behavior here is unverified.
7. ADR 0005 lacks a `Vary` rule. The zone ignores `Vary`, so a shared-cacheable response that varies on a cookie leaks. The prototype stores any `Vary` other than `accept-encoding` as `no-store`.
8. Our plan does not cover CSP as a header on prerendered pages. The prototype used Astro's `staticHeaders` and `routeToHeaders` for that. Decide before M2.
9. Bunny's limits in practice: 129 variables or about 250 KB of values breaks every request with no API error, and changed variables never reach warm isolates. Our rollback check and README need both facts.
10. The cold path is the normal path at low traffic: practically zero isolate reuse at one request per minute or slower, 300 to 1,000 ms cold server routes for 3 to 9 MB. These are the prototype's 2026-10-16 numbers, to re-measure with our build before setting budgets.
