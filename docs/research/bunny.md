# Bunny platform research

What the bunny.net platform offers and constrains for an Astro adapter that targets Edge Scripting in two modes: **standalone** (the script is the pull zone origin) and **middleware** (the script sits in front of a storage-origin pull zone). Researched 2026-10-28.

## How to read this

Every claim carries one of these tags and a source key from the table below.

- **[doc]** stated in official bunny.net docs, the API spec, the SDK types, or the CLI.
- **[measured YYYY-MM-DD]** measured by us on live resources.
- **[expected]** follows from a documented fact but nobody checked it.
- **[open]** unknown; listed again under [Open questions](#open-questions).

### Sources

| Key | Source |
| --- | --- |
| `F:n` | bunny-edge-deploy `docs/bunny-findings.md`, line `n` (our measurements, 2026-09-23 to 2026-10-02) |
| `REF` | the reference site's recorded decision on running a Bunny middleware script per environment (measured 2026-10-14 to 2026-10-20) |
| `mw` | https://bunny.net/docs/scripting/middleware/overview.md |
| `sa` | https://bunny.net/docs/scripting/standalone/overview.md |
| `bc` | https://bunny.net/docs/scripting/before-cache.md |
| `limits` | https://bunny.net/docs/scripting/limits.md |
| `runtime` | https://bunny.net/docs/scripting/runtime.md |
| `env` | https://bunny.net/docs/scripting/environment-variables.md and https://bunny.net/docs/scripting/secrets.md |
| `cache` | https://bunny.net/docs/scripting/cache/index.md and https://bunny.net/docs/scripting/cache/reading-writing.md |
| `fs` | https://bunny.net/docs/scripting/node-fs.md |
| `hdr` | https://bunny.net/docs/cdn/request-headers-to-origin.md |
| `st-http` | https://bunny.net/docs/storage/http.md |
| `st-repl` | https://bunny.net/docs/storage/replication.md and https://bunny.net/docs/storage/storage-tiers.md |
| `smart` | https://bunny.net/docs/cdn/smart-cache.md |
| `purge` | https://bunny.net/docs/cdn/purge-cache.md |
| `etag` | https://bunny.net/docs/cdn/frequently-asked-questions/etag-support.md |
| `astro-cdn` | https://bunny.net/docs/cdn/integrations/frameworks/astro.md |
| `sites` | https://bunny.net/docs/cli/commands/sites.md and https://bunny.net/docs/storage/static-site-hosting/index.md |
| `api` | Core API OpenAPI spec, https://core-api-public-docs.b-cdn.net/docs/v3/public.json (fetched 2026-10-28) |
| `sdk` | `@bunny.net/edgescript-sdk@0.13.0` from npm: `package.json` and `dist/_tsup-dts-rollup.d.ts` (read 2026-10-28) |
| `cli` | Bunny CLI 0.19.0 (`bunny scripts --help`, run 2026-10-28) and the `bunny-cli` skill references `scripts.md`, `sites.md`, `storage.md` |

## Script types and lifecycle

### Standalone

- The script replaces the origin server; a handler takes a `Request` and returns a `Response` via `BunnySDK.net.http.serve(handler)`. [doc] `sa`, `sdk`
- On the Bunny runtime `serve()` calls `Bunny.v1.serve(handler)`. [measured 2026-09] `F:170`
- Created with `POST /compute/script {ScriptType: 1}` and attached with `POST /pullzone {OriginType: 4, EdgeScriptId}`. [measured 2026-09-30] `F:8`, enum values `F:205`
- By default it runs only on a cache miss; cache hits never invoke it. [doc] `sa`, `bc`; [measured] `F:150`
- A request reaching it carries `host` and `cdn-host` set to the public hostname. [measured 2026-09-30] `F:14`
- What `request.url` holds in standalone mode (public host or an internal one) is not recorded. [open]

### Middleware

- Registered with `servePullZone(...)` and chained hooks; on Bunny this calls `Bunny.v1.registerMiddlewares({ onOriginRequest: [...], onOriginResponse: [...] })`. A script calling that directly, without the SDK, works. [doc] `mw`; [measured 2026-09-30] `F:39`, `F:170`
- Attached with `POST /pullzone {OriginType: 2, StorageZoneId, MiddlewareScriptId}` or later via `POST /pullzone/{id} {MiddlewareScriptId}`; detach with `0`. [measured 2026-09-30] `F:39`, `F:199`
- Hooks and what they may return. [doc] `mw`, types in `sdk`
  - `onOriginRequest({request})`: cache miss only. Return a `Request` to continue to the origin, or a `Response` to short-circuit. A short-circuit response is treated like an origin response and can be cached.
  - `onOriginResponse({request, response})`: after the origin, before the cache. Return a `Response`; what it returns is what gets cached.
  - `onClientRequest` and `onClientResponse`: run on every request including hits, only when the pull zone has `EdgeScriptExecutionPhase: 2` ("Run script before cache"). Silently skipped otherwise.
- `servePullZone({ url })` uses `url` only in local development; in production the pull zone origin applies. [doc] `mw`, `sdk`
- A short-circuit `Response` from `onOriginRequest` does not pass through `onOriginResponse`. [measured 2026-09] `F:149`
- A `Request` returned with a rewritten path reaches storage at that path, and `onOriginResponse` sees the rewritten URL. A visitor cannot reach the prefix directly because the middleware prefixes it again. [measured 2026-09-30] `F:40`
- In `onOriginRequest`, `request.url` is the storage origin (`http://storage.bunnycdn.com:9000/...`), not the public URL. The public host is only in `host`, with `x-forwarded-proto: https`. Astro's origin check on POST fails unless the URL is rebuilt from `host`. [measured 2026-10-01] `F:64`
  - Bunny's Astro guide says the CSRF check reads `Sec-Fetch-Site`; that guide uses a URL origin, not a script. [doc] `astro-cdn`
- `onOriginResponse` sees storage's status, a `content-type` sniffed from the extension, and a weak `etag`. [measured 2026-09-30] `F:42`
- A throwing middleware gives the visitor 500 with an empty body and `cache-control: no-cache`; the request does not fall through to storage. [measured 2026-09-30] `F:43`
- A storage 404 reaches `onOriginResponse`, which can replace it with a 200 that is then cached per its own `Cache-Control`. [measured 2026-09] `F:157`
- Right after a publish to a brand new zone, one PoP served 404 for a script-rendered route for about a minute. [measured 2026-10-02] `F:109`

### Latency of the two modes

- A standalone script reads every static file from the storage main region, so its replicas are never used. From New York, a static miss took about 420 ms standalone against about 85 ms through middleware with a NY replica. [measured 2026-09-30] `F:55` to `F:63`
- From Europe the two modes were equal within noise. [measured 2026-09-30] `F:46` to `F:54`; the reference site saw middleware 30 to 60 ms faster on static misses from Prague and Amsterdam. [measured 2026-10-14] `REF`
- Script execution on the LA PoP was unexplainedly slow (300 to 500 ms) for both modes, while a trivial script answered in 48 ms. [measured 2026-10-01, 2026-10-02] `F:84`, `F:128`

## Runtime environment

- Based on a customized Deno runtime; "a subset of what is available from Deno or Node". [doc] `runtime`
- Reports Deno 2.7.12, V8 14.7, `process.version` v24.2.0. [measured 2026-09] `F:174`
- Working `node:` modules include buffer, crypto, events, fs, http, path, stream, url, util, zlib, async_hooks. Failing: child_process, cluster, vm, worker_threads, v8, tty, and others. [measured 2026-09] `F:175`, `F:176`
- Globals include `Buffer`, `process`, `caches`, `HTMLRewriter`, `WebSocket`, `URLPattern`, `CompressionStream`, `crypto.subtle`. [measured 2026-09] `F:177`
- `npm:` and `https://esm.sh/` specifiers resolve at runtime. Loading Shiki as `npm:` kept the script at 2.95 MB instead of 12.85 MB but raised cold start median from 0.27 s to 0.44 s. [measured 2026-09-30] `F:169`, `F:132` to `F:134`
- A virtual file system lives in script memory, with read/write `/tmp` and `/home/user`, capped at 64 MB. [doc] `fs`
- `Bunny.v1.waitUntil(promise)` keeps the isolate alive until the promise settles; it may be called many times. [doc] `runtime`; present in `onOriginRequest` [measured 2026-09-30] `F:44`
- Consecutive cache misses may land on different isolates. [measured 2026-09] `F:171`

### Limits

| Limit | Documented [doc] `limits` | Measured |
| --- | --- | --- |
| CPU time per request | 30 s | |
| Active memory | 128 MB | |
| Subrequests per request | 50 | |
| Script size | 10 MB | API accepted 12 MB; 9.5 MB and up returned 400 after the first request. 2, 5 and 8 MB booted. [measured 2026-09] `F:166`, `F:167` |
| Startup time | 500 ms | 2 MB of real code: cold 460 to 520 ms; 5 MB: cold 1.1 to 1.9 s, still served. [measured 2026-09] `F:168` |
| Env variables per script | 128 | 129 breaks boot; secrets do not count. [measured 2026-09] `F:181` |
| Env variable value | 2 KB | 2049 bytes breaks boot, and then every request (static too) returns 400. [measured 2026-09] `F:180`, `F:181`. Second measurement: the API refuses values over 4,096 characters, and about 242 to 254 KB of values in total answers 431 on every request. [measured in the prototype, 2026-10-16] |

- Occasional spikes are tolerated; consistent overruns get throttled or terminated. [doc] `limits`
- Pricing: $0.20 per million requests plus $0.02 per 1000 s CPU. [doc, as recorded] `F:209`

### Environment variables and secrets

- Read with `Deno.env.get(name)` or `process.env[name]`; secrets read the same way and cannot be read back. Names are unique across both. [doc] `env`; [measured 2026-09-30] `F:44`, `F:185`
- A changed value reaches only new isolates; a running isolate kept the old value for at least 45 s. Republishing the same code brought the new value within 2 s. [measured 2026-09-30] `F:182`, `F:183`
- Values are per script, not per release, so a rollback keeps current values. [measured 2026-09] `F:184`
- API: `PUT /compute/script/{id}/variables` and `PUT .../secrets` (upsert). CLI: `bunny scripts env set NAME value [--secret]`. [measured] `F:186`; [doc] `cli`

### Cache API

- `caches.default` and `caches.open(name)` with `match`, `put`, `delete` only; no `keys`, `matchAll`, or options bag. [doc] `cache`
- Entries live per region and do not replicate; TTL comes from the stored response's `Cache-Control`; 100 MB per entry. [doc] `cache`
- Measured per PoP, not per region: a key written at the DE PoP missed at seven other European PoPs, and one written at NY missed at eight other North American PoPs. [measured 2026-10-28] S1 step 3a
- With the pull zone set to "Override: do not cache", `put()` silently stores nothing. [doc] `cache`
- Keys must use the requesting hostname. [doc] `cache`

## Request headers Bunny adds

All from [doc] `hdr` (origin requests), confirmed as seen by a script where marked.

- Client IP: `X-Real-IP` and `X-Forwarded-For`, always a single address; a visitor-sent value is discarded. Seen by a script. [measured 2026-09-30] `F:14`, `F:44`
- Country: `CDN-RequestCountryCode` (ISO 3166-1 alpha-2); `CDN-RequestStateCode` when known. Country seen by a script. [measured] `F:14`, `F:44`
- Request id: `CDN-RequestId`, equal to the response header without Origin Shield. Seen by a script. [measured] `F:14`
- Also: `CDN-Host` (public hostname; no `X-Forwarded-Host`), `X-Forwarded-Proto`, `CDN-PullZoneId`, `CDN-ServerZone`, `CDN-MobileDevice`, `CDN-JA4`, `CDN-Bot` (with Shield), `Via: BunnyCDN`.
- For GET and HEAD the visitor's `Range`, `If-None-Match`, `If-Modified-Since` and related headers are not forwarded; HEAD goes to the origin as GET. Header names containing `_` are dropped. Whether this applies to a script origin as it does to a URL origin is [expected], not checked.
- Bunny revalidates expired entries with `If-None-Match` / `If-Modified-Since` when the cached response had `ETag` / `Last-Modified`. [doc] `hdr`

## Bunny Storage HTTP API

- Auth: header `AccessKey: <storage zone password>`; the account API key is rejected. [doc] `st-http`; [measured] `F:189`
- Regional endpoints by main region: `storage.bunnycdn.com` (DE), `uk.`, `ny.`, `la.`, `sg.`, `se.`, `br.`, `jh.`, `syd.storage.bunnycdn.com`. [doc] `st-http`
- Only the main region's endpoint answers; replica endpoints returned 401 with the zone's read-only password. So a script reading the Storage API always reads the main region. [measured 2026-09-30] `F:66`
- Replication: uploads go to the main region and replicate out; the CDN reads the replica nearest the PoP. Replicas cannot be removed. Standard tier up to 9 regions, Edge (SSD) up to 15 with DE as required main region. [doc] `st-repl`
- Upload `PUT` with raw body, optional `Content-Type`, optional `Checksum` (uppercase hex SHA-256; mismatch gives 400). [doc] `st-http`; [measured] `F:190`
- Listing `GET .../dir/` returns JSON per directory, not recursive, with an uppercase SHA-256 `Checksum` per file and an empty `ContentType`. [doc] `st-http`; [measured] `F:191`
- `DELETE` on a directory removes it recursively; deleting the root needs `allowRootDelete=true`. [doc] `st-http`; [measured] `F:17`
- Limits: 100 concurrent connections per IP, 5 concurrent listings, 30 concurrent deletes, 6000-character paths. [doc, as recorded] `F:193`
- Storage zone passwords (`Password`, `ReadOnlyPassword`) and `StorageHostname` come back from `POST /storagezone`. [measured] `F:11`
- Range and conditional requests directly against the Storage API are not documented. [open]
- Through a pull zone: storage sends no `Cache-Control`, and content type is sniffed from the extension. [measured] `F:154`, `F:155`
- Writes for sessions: no conditional write, lock, or TTL is documented, and every write and read goes to the main region. [doc, absence] `st-http`; suitability is [open]

## Pull zone settings that affect a script

| Setting (API field) | Default, storage origin | Default, script origin | Effect on the adapter |
| --- | --- | --- | --- |
| `CacheControlMaxAgeOverride` | 2592000 | -1 | At 2592000 every response is cached 30 days, including `private` and `no-store`; one visitor's cookie page was served to another. [measured] `F:142`, `F:9` |
| `DisableCookies` | true | true | Strips `Set-Cookie` from responses. Bunny's own Astro guide says to turn it off. [measured] `F:9`, `F:202`; [doc] `astro-cdn`, `api` |
| `EnableSmartCache` | false | false | When on, only listed static extensions are cached and `text/html`, `application/json`, `application/xml` never are, prerendered HTML included. [doc] `smart` |
| `EnableCacheSlice` ("Optimize for video") | true | false | When on, storage answers 206 and the visitor gets no `ETag`, so 304s never happen. Off restores `ETag` and 304; ranges still work. [measured 2026-10-01] `F:65`; ETag passthrough needs it off [doc] `etag` |
| `IgnoreQueryStrings` | true | true | Query string is not part of the cache key; Optimizer image widths need it false. [measured] `F:148`; [doc] `astro-cdn` |
| `EdgeScriptExecutionPhase` | 0 | 0 | 0 runs after cache; 2 runs before cache on every request. [doc] `bc`, `api` |
| `UseStaleWhileUpdating` | false | false | `stale-while-revalidate` alone is not honored asynchronously; this setting makes expired entries serve `STALE`. [measured] `F:147` |
| `CacheErrorResponses` | false | | Error responses were not cached. [measured] `F:151` |
| `OptimizerEnabled` | false | | See below. [measured] `F:202` |

Caching behavior with `CacheControlMaxAgeOverride: -1`:

- `public, max-age`, `s-maxage`, `max-age` with `stale-while-revalidate`: cached. `private`, `no-store`, `no-cache`, `max-age=0`: not cached. [measured] `F:144`, `F:145`, `F:12`
- **No `Cache-Control` at all: Bunny adds `public, max-age=2592000` and caches 30 days**, for script responses and for middleware short-circuits alike. [measured] `F:45`, `F:146`
- Storage files with no `Cache-Control` go out with `max-age=25600000`. [measured] `F:154`
- Cookies are never part of the cache key. [measured] `F:148`
- Compression (gzip, br, zstd) is automatic and has no pull zone switch; a compressed strong `ETag` becomes weak. [measured] `F:196`; [doc] `etag`
- Origin types: 2 is storage zone, 4 is edge script. [doc] `api`, `F:205`

### Purge and cache tags

- `POST /pullzone/{id}/purgeCache` with `{CacheTag}` purges entries whose `CDN-Tag` response header matches; no body purges the zone. [doc] `purge`, `api`
- `CDN-Tag` values are truncated at 1024 bytes. [doc] `purge`
- `POST /purge?url=...` purges a URL or, with `*` or a trailing `/`, a prefix. Rate limits: about 300 exact (or tag) purges and about 30 prefix (or full zone) purges per minute per account. [doc] `purge`; wildcard purge works [measured] `F:198`
- Whether a `CDN-Tag` set by a script response is honored the same way as from a URL origin: [expected], not checked. Tag purges are unsupported with Perma-Cache. [doc] `purge`

### Optimizer

- Documented with a URL origin (Node adapter) and with static Storage sites: a custom Astro image service adds `?width=` and `?quality=`, with query string vary on. [doc] `astro-cdn`, `sites`
- Whether Optimizer transforms images served by a standalone script or passed through middleware is not documented. [open]
- Price: $9.50 per zone per month. [doc, as recorded] `F:209`

## Deploying a script

- CLI: `bunny scripts create [name] --type standalone|middleware` (creates a linked pull zone by default), `bunny scripts deploy <file> [id]` (upload and publish, `--skip-publish` to upload only), `bunny scripts deployments publish <release-id>` to roll back. [doc] `cli`
- API: upload code with `POST /compute/script/{id}/code`, publish with `POST /compute/script/{id}/publish` (optional `Note`), republish an older release with `POST /compute/script/{id}/publish/{releaseId}`. [measured] `F:15`, `F:31`, `F:166`
- Release ids are 8-character strings; republishing an older release adds no new release. `GET .../releases/active` returns the note and full code; 404 for a never-published script. [measured] `F:15`, `F:31`, `F:35`
- If each release names its own `deploys/<id>/` storage folder, a rollback restores code and static files together. [measured 2026-09-30] `F:16`
- GitHub: `BunnyWay/actions/deploy-script` with a per-script `DeploymentKey`; its endpoint is undocumented. [doc, as recorded] `F:210`
- Only one full-access account API key exists; no scoped keys are documented. [doc, as recorded] `F:210`
- A trial account without a verified card was suspended mid-run; zones then answered 403 and storage rejected its own passwords. [measured 2026-09-30, 2026-10-14] `F:136` to `F:139`, `REF`

## Static file deploys

- `bunny sites` (Public Preview) creates a storage zone plus pull zone, uploads each deploy to an immutable `deploys/<id>/` folder, and publishes by retargeting an `OriginStorage` edge rule plus a purge. No script and no SSR. [doc] `sites`, `cli`
- Deploy ids are the git short SHA or a content hash, or `--deploy-id`. SPA fallback via `--spa` or `sites.spa`; otherwise a root `404.html`. [doc] `sites`, `cli`
- `_headers` and `_redirects` files are not mentioned anywhere in the bunny.net docs index. [doc, absence] https://bunny.net/docs/llms.txt
- Version note: this research ran Bunny CLI 0.19.0. A later read of the 0.21.0 README (in the runtime advice for the design) says `bunny sites` blocks `_bunny/` and `deploys/` at the edge. A newer CLI may also know `_headers` and `_redirects`; prior art claims the `bunny sites` router reads them [read, not checked]. Checked in spike L2.
- What edge rules can express in their place: `SetResponseHeader` per path pattern, `Redirect` (target must be an absolute URL, `https://%{Url.Hostname}/...` works), `BlockRequest`, `OverrideBrowserCacheTime`; 50 rules per zone, 5 triggers per rule. [measured 2026-09-30] `F:20` to `F:36`, `F:163`
- A storage-origin zone without middleware serves `/x` and `/x/` from `x/index.html` with 200. [measured] `F:41`
- An `OriginStorage` edge rule cannot bypass a middleware script; the script still runs. [measured] `F:161`

## Local development

- The SDK runs on Deno and Node (package `exports` has `deno` and `node` entries). `serve({port, hostname}, handler)` and `servePullZone({port, hostname}, {url})` start a local server; the middleware hooks proxy to `url`. [doc] `sdk`
- Bunny documents `deno run -A script.ts` and testing on `http://127.0.0.1:8080`. [doc] `mw`, `sa`
- Bunny CLI 0.19.0 has no local dev or emulation command for scripts. [doc] `cli`
- A local Deno harness that stubs `globalThis.Bunny` imports a 320 KB bundle in about 9 ms, which works as a startup probe but not as a timing match for the edge. [measured 2026-09] `F:170`, `F:134`
- Whether the SDK's local `servePullZone` emulates the production `request.url` (storage origin) and Bunny's added headers is [open].

## Implications for the adapter design

- **One render core, two thin entries.** The modes differ only in the entry call (`serve` vs `registerMiddlewares`) and in how static files are reached, so keep everything else shared.
- **Rebuild the request URL in middleware mode** from `host` and `x-forwarded-proto` before Astro sees it, or every POST fails Astro's origin check (`F:64`). Check standalone mode the same way.
- **Never send a response without `Cache-Control`.** Bunny caches it for 30 days. Default on-demand responses to `private, no-store` (or the route's explicit value), and default 404/500 pages to the same.
- **Deploy tooling must set the pull zone, not assume defaults:** `CacheControlMaxAgeOverride: -1`, `DisableCookies: false`, `EnableCacheSlice: false` on storage-origin zones. Leave Smart Cache off or prerendered HTML will never be edge-cached.
- **Middleware mode is the better default for sites with many static files** outside Europe, since only it reads storage replicas. Standalone is simpler and fine for EU-only or mostly on-demand sites.
- **Middleware routing lives in `onOriginRequest`:** render the route and return a `Response`, or return a `Request` rewritten to `deploys/<id>/<path>` (with `/x` and `/x/` mapped to `x/index.html`). Use `onOriginResponse` for headers on static files and for replacing storage 404s with Astro's 404 page.
- **Catch everything in the hooks.** A throw becomes an empty 500 with no fall-through.
- **Standalone static serving reads the main region over HTTP** with the zone's read-only password; return the file with `ETag`/`Last-Modified` and a cache header. The CDN, not the script, answers conditional and range requests on GET (expected, see `hdr`).
- **Keep the bundle well under 5 MB** and avoid top-level work; startup over 500 ms is measurable and 9.5 MB fails. Offer an option to leave heavy packages as runtime `npm:` imports.
- **Read env vars at request time through one accessor** (`Deno.env.get` / `process.env`), and document that a changed value needs a republish to reach traffic.
- **Expose `waitUntil` to Astro** through `Bunny.v1.waitUntil`, and client IP and country through `x-real-ip` and `cdn-requestcountrycode`.
- **Sessions on Bunny Storage are possible but weak:** main-region only, no atomic or conditional writes, no TTL. Keep the session driver swappable; Bunny Database (https://bunny.net/docs/database/connect/scripting.md) may fit better and is not researched here.
- **Leave before-cache mode (`onClientRequest`) out of the first version** unless a feature needs per-request logic on cache hits; it runs the script on every hit and costs per request.
- **Do not depend on `_headers`/`_redirects` being a platform feature.** If the adapter supports them, it has to translate them itself (middleware or edge rules).

## Open questions

1. What does `request.url` contain in a standalone script: the public URL or an internal one?
2. Does the CDN strip the visitor's `Range` and `If-*` headers before a script origin, as it does for URL origins, and turn HEAD into GET?
3. Does the Storage API honor `Range`, `If-None-Match` and `If-Modified-Since` on direct reads, and which `ETag` does it return?
4. Does Bunny Optimizer transform images when the origin is a standalone script, or when middleware passes storage files through?
5. Is a `CDN-Tag` header on a script or middleware response honored for tag purges?
6. Does the SDK's local `servePullZone` reproduce the production `request.url` and Bunny's added headers?
7. Is Bunny Storage usable as an Astro session store (read-after-write at the main region, concurrency, cost), or should sessions target Bunny Database?
8. Why is script execution slow on the LA PoP (`F:84`, `F:128`), and does it affect other PoPs?
9. How long after a publish is a new middleware active on every PoP (`F:109`)?
10. Are there account caps on the number of scripts and pull zones (raised in `REF`)?
