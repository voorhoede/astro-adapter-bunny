# Astro 7 platform research

What Astro 7 requires from, and offers to, an adapter. Researched on 2026-10-28 against `astro@7.4.2` (latest on npm, published 2026-10-21).

## How to read this document

Every claim carries one of three labels:

- **[V]** Verified. The source is linked. "Docs" means the docs.astro.build page (read from its MDX source in `withastro/docs` on `main`). "Core" means the compiled `astro@7.4.2` npm package, with the file path under `dist/`.
- **[E]** Expected but not checked. A reasonable inference, not confirmed in docs or code.
- **[?]** Open question. Listed again at the end.

Official adapters (`@astrojs/node@11.1.9`, `@astrojs/cloudflare@14.4.2`) were read for patterns only. They are described, not quoted.

## Version landscape (v5, v6, v7)

- [V] Astro 7 ships Vite 8, the Rust compiler as the only compiler, `compressHTML: 'jsx'` as default, and removes `@astrojs/db`. Source: [Upgrade to v7](https://docs.astro.build/en/guides/upgrade-to/v7/).
- [V] Astro 7 stabilizes route caching (`cache`, `routeRules` move out of `experimental`) and advanced routing (`src/fetch.ts`, now a reserved file name). Source: [Upgrade to v7](https://docs.astro.build/en/guides/upgrade-to/v7/).
- [V] The v7 upgrade guide lists no Adapter API breaking changes. The big adapter API change was v6. Source: [Upgrade to v7](https://docs.astro.build/en/guides/upgrade-to/v7/).
- [V] v6 changes that matter to an adapter. Source: [Upgrade to v6](https://docs.astro.build/en/guides/upgrade-to/v6/).
  - Node `>=22.12.0` required (v6). `astro@7.4.2` declares `engines.node >=22.23.4` (Core: `package.json`).
  - Vite Environment API: `client`, `ssr`, `prerender` environments. `astro:build:setup` runs once with all environments instead of once per target.
  - `entrypointResolution: 'auto'` plus `createApp()` replaces `createExports()`, `start()`, `exports` and `args` (all deprecated).
  - `NodeApp`, `loadManifest()`, `loadApp()` deprecated. `createRequest()` and `writeResponse()` from `astro/app/node` replace them.
  - Removed: `astro:ssr-manifest` virtual module, `RouteData.generate()`, `routes` on `astro:build:done`, `entryPoints` on `astro:build:ssr`, the old `app.render(request, routeData, locals)` signature, `app.setManifestData()`.
  - `SSRManifest` path fields are `URL` objects. `serverIslandMappings` and `sessionDriver` became async functions.
  - Session driver config changed from a string name to an object (`sessionDrivers.x(...)`).
  - `i18n.routing.redirectToDefaultLocale` now defaults to `false` and requires `prefixDefaultLocale: true`.
  - Endpoints with a file extension (`/sitemap.xml`) never match with a trailing slash.
  - `import.meta.env` is always inlined at build time. Runtime secrets must go through `astro:env` / `getSecret()` or the platform env.
  - Route pathnames may be partially decoded; `%25` is no longer allowed in route file names.
- [V] v5 merged `output: 'hybrid'` into `output: 'static'` and removed `functionPerRoute`. Source: [Upgrade to v5](https://docs.astro.build/en/guides/upgrade-to/v5/).
- [E] In v5 the adapter features were named `edgeMiddleware` (boolean) and `experimentalStaticHeaders`. In v6 they appear as `middlewareMode: 'classic' | 'edge'` and `staticHeaders`. The current docs only document the new names; I did not find a migration note for the rename.

## Integration hooks an adapter uses

Source for this section, unless noted: [Integration API reference](https://docs.astro.build/en/reference/integrations-reference/).

| Hook | When | What it gives an adapter |
| --- | --- | --- |
| `astro:config:setup` | Before config resolves | `config`, `command` (`dev`, `build`, `preview`, `sync`), `updateConfig`, `addMiddleware`, `injectRoute`, `logger` |
| `astro:route:setup` | Per route, before bundling | Can force `route.prerender` |
| `astro:routes:resolved` | After route discovery | `routes: IntegrationResolvedRoute[]` (pattern, `patternRegex`, `isPrerendered`, `type`, `redirect`, `redirectRoute`, `fallbackRoutes`, `origin`, `generate()`) |
| `astro:config:done` | Config final | `config` (read only), `setAdapter`, `injectTypes`, `buildOutput` |
| `astro:server:setup` / `start` / `done` | Dev only | Vite dev server, middlewares |
| `astro:build:start` | Before build | `setPrerenderer()` (v6+) |
| `astro:build:setup` | Final Vite config | `vite` with `vite.environments`, `pages`, `updateConfig` |
| `astro:build:ssr` | After server build | `manifest` (serialized), `middlewareEntryPoint` |
| `astro:build:generated` | After prerendering, before cleanup | `dir`, `routeToHeaders` (v6+, only with `staticHeaders`) |
| `astro:build:done` | After build | `dir` (client output), `pages`, `assets: Map<pattern, URL[]>` |

- [V] `config.base` as seen by integrations is already normalized by `trailingSlash` (`always` adds a slash, `never` strips it). Source: [Config: base](https://docs.astro.build/en/reference/configuration-reference/#base).
- [V] `dir` on `astro:build:done` and `astro:build:generated` is the client output directory as resolved by Vite (`outDir` for static, `build.client` for server builds). Source: integrations reference, `dir` option.
- [V] `RouteData.distURL` lists the files a prerendered route emitted; empty for on-demand routes. Source: integrations reference, `RouteData.distURL`.
- [V] `RouteType` is `'page' | 'endpoint' | 'redirect' | 'fallback'`. `fallback` is an i18n fallback route. Source: integrations reference, `RouteType`.

## `setAdapter()` fields

Source: [Adapter API](https://docs.astro.build/en/reference/adapter-reference/).

- [V] `name`: unique, used in logs.
- [V] `entrypointResolution: 'auto' | 'explicit'`, default `'explicit'` (deprecated). New adapters must use `'auto'`. `'auto'` means the adapter ships a real module as `serverEntrypoint` (or sets `vite.build.rollupOptions.input`).
- [V] `serverEntrypoint: string | URL`: the module that runs per request. It must "conform to what the host expects", for example an exported `handler` or `export default { fetch }`.
- [V] `previewEntrypoint: string | URL`: default export is `CreatePreviewServer(params) => PreviewServer`. `params` has `outDir`, `client`, `server`, `serverEntrypoint`, `host`, `port`, `base`, `logger`, `headers`, `allowedHosts` (6.2), `open` (7.0.8). `PreviewServer` has `host`, `port`, `urls` (7.2), `closed()`, `stop()`.
- [V] `supportedAstroFeatures` (required). Keys: `staticOutput`, `hybridOutput`, `serverOutput`, `i18nDomains`, `envGetSecret`, `sharpImageService`. Values: `'stable' | 'experimental' | 'limited' | 'deprecated' | 'unsupported'`, or `{ support, message, suppress: 'default' | 'all' }`.
  - [V] Core throws if the map is missing (Core: `dist/integrations/hooks.js`, `runHookConfigDone`).
- [V] `adapterFeatures`:
  - `buildOutput: 'static' | 'server'` (default `'server'`).
  - `middlewareMode: 'classic' | 'edge'` (v6). `edge` exposes `middlewareEntryPoint` in `astro:build:ssr` for a separate bundle.
  - `staticHeaders: boolean` (v6). Enables `routeToHeaders`.
  - `preserveBuildClientDir` (v6) and `preserveBuildServerDir` (v6.4): keep `dist/client` and `dist/server` even for static builds.
- [V] `client.internalFetchHeaders` and `client.assetQueryParams` (5.15): headers on internal fetches (actions, server islands, prefetch) and a query string on asset URLs, for deploy pinning.
- [V] `exports` and `args`: deprecated, do not use.

### Passing build-time config to the runtime

- [V] Recommended pattern is a Vite virtual module registered from `astro:config:setup` and imported by the server entrypoint. Source: [Adapter API, passing build-time configuration](https://docs.astro.build/en/reference/adapter-reference/#passing-build-time-configuration).
- [V] `@astrojs/node` follows this pattern and passes client dir, server dir, host, port and similar values (Core of `@astrojs/node`: `dist/vite-plugin-config.js`).

## Runtime app API

Source: [astro/app reference](https://docs.astro.build/en/reference/modules/astro-app/).

- [V] `import { createApp } from 'astro/app/entrypoint'` (v6). `createApp({ streaming = true })` returns an `App`. Call it once at module scope.
- [V] `app.render(request, options?) => Promise<Response>`. Handles pages and endpoints, and renders the 404 page itself when nothing matches.
- [V] `app.match(request, allowPrerenderedRoutes = false) => RouteData | undefined`.
- [V] `app.removeBase(pathname)`, `app.setCookieHeaders(response)` (generator), `app.getAllowedDomains()` (5.14.2), `app.adapterLogger` (6.2).
- [V] `RenderOptions`:
  - `addCookieHeader` (default `false`): append `Astro.cookies` writes as `Set-Cookie`.
  - `clientAddress`: becomes `Astro.clientAddress`. Default reads `request[Symbol.for("astro.clientAddress")]`.
  - `locals`: initial `context.locals`.
  - `prerenderedErrorPageFetch(url)` (5.6): how to load prerendered `404.html` / `500.html`. Default is `fetch()` to the same server.
  - `waitUntil(promise)` (6.2): forwarded to runtime cache providers for background work.
  - `routeData`: skip internal matching.
- [V] `astro/app/node` exports `createRequest()` and `writeResponse()` for Node `IncomingMessage` / `ServerResponse`. Not needed on a fetch-style runtime.
- [V] In production, `createApp()` builds `App` from `virtual:astro:manifest` and calls `app.setFetchHandler()` with the default export of `virtual:astro:fetchable`. So the user's `src/fetch.ts` (advanced routing) runs inside `app.render()` without adapter work. Core: `dist/core/app/entrypoints/virtual/prod.js`, `dist/core/app/base.js`.

### What `app.match()` actually does

Core: `dist/core/routing/match-request.js`.

- [V] Returns `undefined` immediately when `url.pathname` is in `manifest.assets`.
- [V] `manifest.assets` is a glob of the client output directory at manifest-build time plus SSR-emitted assets, each prefixed with `base` (or `build.assetsPrefix`). Core: `dist/core/build/plugins/plugin-manifest.js`. The code comment says this exists so "adapters in middleware mode" do not match static files against catch-all routes.
- [V] Strips `base`, applies `i18n.domains` mapping, decodes the pathname, then matches by route priority.
- [V] With `allowPrerenderedRoutes = false`: a prerendered static route yields `undefined`; a prerendered dynamic route falls back to the first non-prerendered route that also matches.
- [E] Files copied from `public/` are in `manifest.assets`, since Vite copies `publicDir` into the client output before the glob runs. Not confirmed by running a build.
- [?] Whether prerendered HTML pages are in `manifest.assets` (they are generated after the client build). It does not matter much because `match()` excludes prerendered routes anyway.

## Output mode: static, server, mixed

- [V] User config `output: 'static' | 'server'`, default `'static'`. Per route, `export const prerender = true | false` overrides it. Source: [Config: output](https://docs.astro.build/en/reference/configuration-reference/#output), [On-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/).
- [V] Core sets `settings.buildOutput` from `output`, then flips it to `'server'` when any route is not prerendered. Core: `dist/core/build/index.js`, `dist/core/routing/prerender.js`.
- [V] `setAdapter()` forces `buildOutput = 'server'` unless the adapter passes `adapterFeatures.buildOutput: 'static'`. Core: `dist/integrations/hooks.js`, `runHookConfigDone`. Consequence: with the default, a fully static project still gets a server bundle and the `dist/client` + `dist/server` layout.
- [V] The `buildOutput` value passed to `astro:config:done` is a live getter. Read it before calling `setAdapter()` to learn what the project needs. `@astrojs/cloudflare` reads it there and passes it straight back as `adapterFeatures.buildOutput`, so static projects stay static.
- [V] An adapter is required for server output, otherwise the build throws `NoAdapterInstalled`. Core: `dist/core/build/index.js`.
- [V] With any adapter installed, Astro injects the server islands route unconditionally, and the image endpoint when building for server. Core: `dist/core/routing/create-manifest.js`.
- [V] `SSRManifest.serverLike` (v6) says whether the app has any on-demand routes. Source: integrations reference.

## Static headers (`routeToHeaders`)

- [V] Requires `adapterFeatures.staticHeaders: true`. Delivered in `astro:build:generated` as `Map<string, HeaderPayload>`, `HeaderPayload = { route: IntegrationResolvedRoute, headers: Headers }`. Source: [Adapter API: staticHeaders](https://docs.astro.build/en/reference/adapter-reference/#staticheaders), integrations reference.
- [V] Map keys are the generated pathname (for example `/one`), without `base`. Headers are the full response headers of the prerendered render. Core: `dist/core/build/generate.js`, `renderPath`.
- [V] When `security.csp` is on and `staticHeaders` is on, the CSP goes into the headers map instead of a `<meta>` tag. Source: Adapter API, `staticHeaders`.
- [V] `@astrojs/node` writes only the `Content-Security-Policy` header from this map to a JSON file and applies it when serving the matching static file. Pattern only.

## Redirects

- [V] `redirects` config: `Record<string, string | { status, destination }>`. Supports dynamic params on both sides and external URLs (5.2). Default status 301 for GET, 308 otherwise. File routes beat redirects of the same path. Source: [Config: redirects](https://docs.astro.build/en/reference/configuration-reference/#redirects), [Routing: redirects](https://docs.astro.build/en/guides/routing/#redirects).
- [V] `build.redirects` (default `true`): in static output, emit a meta-refresh HTML file per redirect. "Mostly meant to be used by adapters that have special configuration files for redirects." Source: [Config: build.redirects](https://docs.astro.build/en/reference/configuration-reference/#buildredirects).
- [V] With `build.redirects: false`, prerendering a redirect route writes nothing. With `true`, it writes the meta-refresh template to the route's out file. Core: `dist/core/build/generate.js`.
- [V] Redirect routes appear in `astro:routes:resolved` with `type: 'redirect'`, `redirect`, and `redirectRoute`. Source: integrations reference.
- [V] Two official patterns, described:
  - `@astrojs/node` sets `build.redirects: false` and serves redirects at runtime by calling `app.match(request, true)` (prerendered allowed), then `app.render()`.
  - `@astrojs/cloudflare` sets `build.redirects: false` and writes a host `_redirects` file from the resolved routes.
- [V] `trailingSlash` redirects only apply to on-demand routes. "Trailing slashes on prerendered pages are handled by the hosting platform." Source: [Config: trailingSlash](https://docs.astro.build/en/reference/configuration-reference/#trailingslash).

## URL to file mapping

- [V] `build.format`: `'directory'` (default) writes `/about/index.html`; `'file'` writes `/about.html`; `'preserve'` mirrors the source. Source: [Config: build.format](https://docs.astro.build/en/reference/configuration-reference/#buildformat).
- [V] `/404`, `/500` and `/3xx` always become `404.html`, `500.html`, `3xx.html` at their folder, even in `directory` format. Endpoints are written to their literal name (`/feed.xml`). Core: `dist/core/build/common.js`, `dist/core/constants.js`.
- [V] A file in `public/` at the same output path wins; Astro skips the generated route and warns. Core: `checkPublicConflict` in `dist/core/build/generate.js`.
- [V] `base`: requests carry the prefix; `app.removeBase()` strips it. Files on disk do not carry it. `@astrojs/cloudflare` nests the client directory under `base` so the on-disk path matches the URL. Pattern only.
- [V] `build.assets` (default `_astro`) holds hashed bundles and optimized images. Source: [Config: build.assets](https://docs.astro.build/en/reference/configuration-reference/#buildassets).
- [V] `@astrojs/node` resolves a static request by: strip base, decode, check path traversal, then apply `trailingSlash` (`never`: redirect a directory with slash; `always`: redirect when no slash and no file extension; `ignore`: serve `dir/index.html`). Pattern only.
- [E] `i18n` adds no special file mapping beyond the locale folders in `src/pages/`; prerendered fallback routes are written as normal pages (redirect HTML or rewritten content, per `fallbackType`).
- [V] `i18n.domains` requires `output: 'server'`, `site`, and no prerendered pages. It reads `X-Forwarded-Host` / `Host` and `X-Forwarded-Proto`. Source: [i18n: domains](https://docs.astro.build/en/guides/internationalization/#domains).
- [V] `security.allowedDomains` decides whether `X-Forwarded-Host` is trusted. Empty by default, meaning untrusted. Source: [Config: security.allowedDomains](https://docs.astro.build/en/reference/configuration-reference/#securityalloweddomains).

## Route priority and static files

Source: [Routing: route priority order](https://docs.astro.build/en/guides/routing/#route-priority-order).

- [V] Order: reserved routes, more segments, static over dynamic, named params over rest params, prerendered dynamic over server dynamic, endpoints over pages, file routes over redirects, then alphabetical.
- [V] Reserved routes: `_astro/`, `_server_islands/` (per docs), `_actions/`.
- [V] Core uses `/_server-islands/[name]` with a hyphen, not the underscore the routing page shows. Core: `dist/core/server-islands/endpoint.js`. The server islands guide also shows `/_server-islands/Avatar`. The routing page looks like a docs typo.
- [V] The `[locale]` vs `/favicon.ico` case: an on-demand `src/pages/[locale]/index.astro` route pattern matches `/favicon.ico`. `app.match()` only avoids that because `/favicon.ico` is listed in `manifest.assets`. Core: `match-request.js`.
- [E] Any file that exists at the origin but not in `manifest.assets` (uploaded outside the build, or added after) will be claimed by such a catch-all SSR route. A static-first lookup avoids this; `@astrojs/node` standalone serves a file if one exists, and only then calls the app.
- [V] `prerenderConflictBehavior: 'error' | 'warn' | 'ignore'` (v6, default `warn`) handles two routes producing one prerendered URL. Source: [Config](https://docs.astro.build/en/reference/configuration-reference/#prerenderconflictbehavior).

## Advanced routing (`src/fetch.ts`)

Source: [Routing: advanced routing](https://docs.astro.build/en/guides/routing/#advanced-routing), [astro/fetch](https://docs.astro.build/en/reference/modules/astro-fetch/).

- [V] v7. `src/fetch.ts` default-exports `{ fetch(request) }`. Rename with `fetchFile`, disable with `fetchFile: null`.
- [V] Default pipeline order: trailing slash, redirects, sessions, actions, user middleware, pages, i18n, caching. `astro()` runs it all; individual handlers (`trailingSlash`, `redirects`, `sessions`, `actions`, `middleware`, `pages`, `notFound` (7.4), `i18n`, `cache`) can be composed.
- [V] Runs inside `app.render()` in production (see runtime section). Nothing extra for the adapter.
- [E] The adapter's own request handling (static lookup, pass-through to origin) happens before `app.render()`, so it runs before any user `src/fetch.ts` logic. Users cannot intercept static files through `src/fetch.ts`.

## Middleware

- [V] `classic` mode: middleware runs at build for prerendered pages and per request for on-demand pages only. Source: [Adapter API: middlewareMode](https://docs.astro.build/en/reference/adapter-reference/#middlewaremode).
- [V] Middleware runs for on-demand 404 and 500 pages, but "it is up to the adapter to decide whether that code runs". Source: [Middleware: error pages](https://docs.astro.build/en/guides/middleware/#error-pages).
- [V] Response headers can only be changed at page level because of HTML streaming. `createApp({ streaming: false })` disables streaming. Source: [On-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/), astro/app reference.

## Sessions

Source: [Sessions guide](https://docs.astro.build/en/guides/sessions/), [Session Driver API](https://docs.astro.build/en/reference/session-driver-reference/).

- [V] A driver is `{ entrypoint: string | URL, config? }` (v6). The runtime module default-exports `(config) => { getItem, setItem, removeItem }`, all async.
- [V] `sessionDrivers` from `astro/config` wraps every unstorage built-in driver (camelCase names). Core: `dist/core/session/drivers.js`.
- [V] Node, Cloudflare and Netlify adapters provide a default driver; others require the user to set one.
- [V] `session: false` (7.2) tells the adapter not to inject a default driver. With no driver, the session runtime is left out of the bundle.
- [V] Pattern used by `@astrojs/node` and `@astrojs/cloudflare`: in `astro:config:setup`, if `config.session !== false` and no driver is set, call `updateConfig({ session: { driver, cookie, ttl } })` keeping the user's cookie and ttl.
- [V] Sessions only exist for on-demand routes.

## Route caching and cache providers

Source: [Route caching](https://docs.astro.build/en/guides/caching/), [Cache Provider API](https://docs.astro.build/en/reference/cache-provider-reference/).

- [V] Stable in v7. User sets `cache.provider` and optional `routeRules` (route-pattern syntax, same priority as file routes). Routes call `Astro.cache.set({ maxAge, swr, tags, lastModified, etag })` and `cache.invalidate({ tags | path })`.
- [V] Two provider kinds:
  - CDN provider: `setHeaders(options, request) => Headers`. Astro strips these headers before the response reaches the client.
  - Runtime provider: `onRequest({ request, url, waitUntil, logger }, next)`; adds `X-Astro-Cache: HIT | MISS | STALE`.
  - Both require `name` and `invalidate(options)`.
- [V] A provider is a config helper returning `{ entrypoint, config }` plus a runtime module that default-exports `CacheProviderFactory`. The runtime module must be runtime-agnostic.
- [V] Helpers for CDN providers in `astro/cache/provider-utils`: `buildCacheControlDirectives`, `pathTag` (`astro-path:{path}`), `setConditionalHeaders`, `collectInvalidationTags`, `normalizeTags`.
- [V] Netlify, Vercel and Cloudflare ship experimental CDN providers that users enable by hand; docs say adapters will enable them automatically "in a future release".
- [V] In dev, `cache.enabled` is `false` and all cache calls are no-ops. Testing needs build plus preview.
- [V] `memoryCache()` is an in-process LRU "suitable for single-instance deployments".
- [?] The headers stripped before the client sees them: does that happen before or after the response leaves the script? If Astro strips `CDN-Cache-Control` / `Cache-Tag` inside `app.render()`, a CDN provider for Bunny must translate them into something Bunny reads that Astro does not strip, or the pull zone never sees them.
- [?] No documented `setAdapter` field for a default cache provider. Expected route is `updateConfig({ cache: { provider } })` in `astro:config:setup`, like sessions. Unchecked.

## Image service

Source: [Image Service API](https://docs.astro.build/en/reference/image-service-reference/), [Config: image.endpoint](https://docs.astro.build/en/reference/configuration-reference/#imageendpoint).

- [V] Local services implement `getURL`, `parseURL`, `transform`; external services implement `getURL` only. Optional: `getHTMLAttributes`, `getSrcSet`, `validateOptions`, `getRemoteSize` (v6). Hooks receive a `logger` since 7.3.
- [V] Prerendered pages call `transform()` at build and write to `_astro/`. On-demand pages and dev use the `/_image` endpoint (`image.endpoint.route`).
- [V] `astro/assets/endpoint/*` ships `generic`, `node`, `dev`. `generic` loads local images by `fetch()`ing them from the request's own origin; `node` reads them from disk. Core: `dist/assets/endpoint/`.
- [V] `@astrojs/node` sets `image.endpoint.entrypoint` to the `node` endpoint for build and `dev` for dev. Pattern only.
- [V] `sharpImageService` in `supportedAstroFeatures` tells Astro whether Sharp can run at runtime. `@astrojs/cloudflare` marks it `limited` and swaps the runtime image service, keeping build-time transforms. Pattern only.
- [E] Sharp (native binary) will not run in Bunny Edge Scripting. Build-time transforms of prerendered pages still work because they run in Node during `astro build`.

## Environment variables and secrets

- [V] `envGetSecret` in `supportedAstroFeatures` enables `getSecret()` from `astro:env/server`. Default implementation is `process.env` in dev and build. Source: [astro:env](https://docs.astro.build/en/reference/modules/astro-env/), [Adapter API: envGetSecret](https://docs.astro.build/en/reference/adapter-reference/#envgetsecret).
- [V] The adapter calls `setGetEnv(key => ...)` from `astro/env/setup` before `getSecret()` is used, at module scope or per request when env is request-bound. Same source.
- [V] `import.meta.env` is inlined at build since v6, so it cannot carry runtime secrets. Source: Upgrade to v6.

## Server islands

Source: [Server islands](https://docs.astro.build/en/guides/server-islands/).

- [V] `server:defer` requires an adapter, even on a fully static site. Source: [On-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/).
- [V] Islands are fetched with GET on `/_server-islands/<name>` with encrypted props in the query; POST when the URL exceeds 2048 bytes.
- [V] The encryption key is random per build unless `ASTRO_KEY` is set (`astro create-key`). A CDN serving cached pages from an older build will send props the new server cannot decrypt.
- [V] `security.serverIslandBodySizeLimit` exists. Source: [Config](https://docs.astro.build/en/reference/configuration-reference/#securityserverislandbodysizelimit).

## Dev, build, preview

- [V] Dev: Astro runs its own Vite dev server. The adapter's server entrypoint is not used unless the adapter plugs into the Vite environment API (Cloudflare does this to run in workerd). Source: Upgrade to v6, Vite Environment API; Integration API, `astro:server:setup`.
- [V] Integrations see `command` in `astro:config:setup`, so dev and build config can differ.
- [V] Preview: when `buildOutput` is `'static'` and the adapter has no `previewEntrypoint`, Astro serves the client dir itself. Otherwise the adapter must provide `previewEntrypoint` or `astro preview` throws "does not support the preview command". Core: `dist/core/preview/index.js`.
- [V] Because `setAdapter()` defaults to `buildOutput: 'server'`, an adapter that does not pass `buildOutput: 'static'` needs a `previewEntrypoint` even for static sites. Follows from the two facts above.
- [V] `server.headers` applies to `astro dev` and `astro preview`, and reaches the preview entrypoint as `params.headers`. Source: [Config: server.headers](https://docs.astro.build/en/reference/configuration-reference/#serverheaders).
- [V] `setPrerenderer()` (v6) lets an adapter prerender in its own runtime. Factory receives the default prerenderer and, since 7.4, `outputDirectories` (`client`, `server`, `prerender`). Source: [Adapter API: custom prerenderer](https://docs.astro.build/en/reference/adapter-reference/#custom-prerenderer).

## Implications for the adapter design

- Use `entrypointResolution: 'auto'` with a real server module that calls `createApp()` once and exports whatever Bunny's runtime expects. Peer `astro@^7`; nothing in the v7 adapter surface changed since v6.
- Pass build-time values (script type, client dir, base, format) through a Vite virtual module, not `args`.
- Decide `buildOutput` deliberately. Reading `buildOutput` in `astro:config:done` before `setAdapter()` and passing it back keeps fully static sites static. Leaving the default forces a server bundle and a `previewEntrypoint` for every project.
- Middleware script type: `app.match(request)` returning `undefined` is the signal to pass through to the storage origin. It already excludes build assets and prerendered routes. It does not know about files that are in storage but not in `manifest.assets`.
- Middleware script type, redirects: either set `build.redirects: false` and match with `allowPrerenderedRoutes = true` so the script answers redirect routes, or keep meta-refresh HTML in storage. The first gives real 301/308 status codes.
- Standalone script type: own the static-file lookup (base strip, decode, traversal guard, `build.format` and `trailingSlash` mapping, `404.html`) and call the app only on a miss or for a matched on-demand route. Node's static-first order is the reference.
- Always pass `prerenderedErrorPageFetch` that reads `404.html` / `500.html` from storage. The default `fetch()` to self is a loop risk and an SSRF surface.
- Pass `clientAddress` from Bunny's client IP header, `waitUntil` if the runtime has one, and `addCookieHeader: true` (or apply `setCookieHeaders`).
- Implement `setGetEnv()` and declare `envGetSecret: 'stable'`.
- Declare `sharpImageService` as `limited` (build-time only) and point `image.endpoint.entrypoint` at a runtime-safe endpoint, or ship a Bunny Optimizer external service. The `generic` endpoint self-fetches originals, which works only if the script can reach its own origin.
- Sessions: Bunny has no obvious default store. Either require a user driver, or provide one, and honor `session: false`.
- Cache: a Bunny CDN cache provider is possible via `setHeaders` plus `invalidate` against Bunny's purge API. Check what Astro strips before shipping it.
- Static headers: opt in to `staticHeaders` so CSP (and other headers) of prerendered pages can be applied by the script or written to Bunny config.
- Treat `ASTRO_KEY` as a documented deploy requirement whenever the pull zone caches pages with server islands.
- `i18n.domains` requires full server output and trustworthy `X-Forwarded-Host`; mark it `unsupported` or `experimental` until Bunny's forwarded headers are verified.

## Open questions

- Is `routeToHeaders` populated for every prerendered route, or only those that set headers? Core sets an entry for every rendered path when the feature is on; confirm by running a build.
- Are files from `public/` in `manifest.assets` in a real 7.4 build? Decides whether middleware mode can trust `app.match()` alone for `/favicon.ico` against a `[locale]` route.
- Does Astro strip cache provider headers inside `app.render()` (before the adapter sees the response) or later?
- Is there a supported way for an adapter to set a default cache provider, beyond `updateConfig` in `astro:config:setup`?
- Which `build.format` should the adapter force, if any? Docs say "This value may be set by an adapter for you"; the official adapters read here do not force it.
- Does the Bunny runtime need `createApp({ streaming: false })`? Depends on whether Edge Scripting streams responses.
- Confirm the docs typo `_server_islands/` vs code `/_server-islands/` with the Astro docs team, or simply rely on `app.match()` instead of hardcoding either.
- The v5 to v6 rename of `edgeMiddleware` and `experimentalStaticHeaders` is from memory and undocumented in the upgrade guide; irrelevant for a v7-only adapter but worth confirming before citing.
