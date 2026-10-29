# Requirements

What the adapter must do for the reference site, its first real consumer, and what an open source adapter needs beyond that. Requirements describe behavior, not implementation.

The reference site is an Astro 7 monorepo with two Sites (site A and site B) that share one Astro config and currently build with a vendored adapter package. The new adapter must be able to replace that package without changes to the Sites beyond the import and the options.

## How to read this

- **Must**: the reference site breaks or violates one of its rules without it.
- **Should**: the reference site relies on it today or will soon, but a workaround exists.
- **Could**: useful, not needed for the replacement.
- **Evidence** describes where in the reference site the requirement comes from: its code, config, deploy tool, a recorded decision, an issue or a pull request. Rows marked *inferred* are conclusions drawn from that evidence, not something the reference site states.
- The vendored adapter's source was not read (clean-room). Where the reference site depends on its behavior, the behavior is taken from the reference site's own docs, config, deploy tooling and commit messages.

## The reference site at a glance (verified)

| Fact | Evidence |
| --- | --- |
| Script type is **middleware**, on every environment | the shared site config; a recorded decision on hosting |
| One adapter call shared by both Sites | both Sites' Astro configs import the shared site config |
| Production build is `output: 'static'` with on-demand routes; the preview build is `output: 'server'` | the shared output config; a recorded decision on the preview build |
| Edge Scripting runs Deno; Node 26 is only the build runtime | the Node version file; an issue comment noting that Edge Scripting runs Deno |
| Pull zone origin is the storage zone; the script is attached as middleware | the deploy tool's pull zone setup and its README section on how a request is served |
| The same build is deployed to a commit environment and a branch environment | the deploy tool's deploy step; a recorded decision on environments |
| Server bundle is about 2.74 MB against a 10 MB script limit; Shiki is aliased out to stay under it | a pull request on the bundle size; a Shiki stub in the shared config |

## Options and entry points the reference site uses

| Option or API | Reference site value | Evidence | Level |
| --- | --- | --- | --- |
| Default export, called as `bunny({...})` from `astro.config` | imported from the vendored package | the shared site config | Must |
| `script` | `'middleware'` | the shared site config | Must |
| `sessions` | `false`, together with Astro `session: false` | the shared site config | Must (accept "off") |
| `assetManifest` | `false`, because files written later by `@astrojs/sitemap` and the service worker integration would be unreachable | the shared site config and the commit that introduced the setting | Must (see R-ROUTE-2) |
| `pageCacheControl` | `'public, max-age=0, must-revalidate'` | the shared site config; an issue comment | Must |
| `headers` (applied to every file served from storage) | security baseline plus `Link`, plus `X-Robots-Tag: noindex` outside production | the shared site config and its response headers module | Must |
| `BunnyRuntime` type export, used for `App.Locals.runtime` | type only; no code reads `locals.runtime` | the shared env type declarations, and a search of all site source | Should |
| `imageService` | not passed; images are not transformed | the dev server log; the deploy tool's pull zone setup (`OptimizerEnabled: false`) | Could |

Option names above are what the reference site passes today. The new adapter may rename them, but then the reference site's single adapter call changes, which is acceptable.

## Requirements

### Build output and deploy contract

The reference site's deploy tooling is its own code and reads a manifest the adapter writes. This is the tightest coupling between the reference site and the adapter.

| ID | Requirement | Level | Evidence |
| --- | --- | --- | --- |
| R-BUILD-1 | Write a machine-readable build description at `<root>/.bunny/build.json` with at least: build kind, script entry path, script type, script size in bytes, client assets directory, and the pull zone settings the build needs (`disableCookies`, `enableSmartCache`, `enableCacheSlice`). | Must | the deploy tool's manifest reader and pull zone setup |
| R-BUILD-2 | Emit one script file at `dist/index.js` (what the reference site uploads) and the client files in a separate directory (`dist/client`). All server code lives in that one script, so `dist/client` holds client files only and a deploy tool needs no change (ADR 0007). | Must | the deploy tool's README, deploy steps 1 and 2; the build output layout |
| R-BUILD-3 | Let the deploy choose the storage path prefix of the client files at deploy time, not build time. The reference site's deploy tool prepends `globalThis.__BUNNY_DEPLOY__ = { id, assetPrefix, site, environment }` to the script. | Must | the deploy tool's deploy step |
| R-BUILD-4 | Read storage access from script environment variables set at deploy time: `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_HOST` and the secret `BUNNY_STORAGE_KEY` (the zone's read-only password). | Must | the deploy tool's deploy step |
| R-BUILD-5 | Fail the build when the script exceeds what Bunny starts reliably. The limit covers the whole script, packed chunks included (ADR 0007). | Should | a pull request on the bundle size; the Shiki stub |
| R-BUILD-6 | One build artifact serves any environment: no hostname, environment name or secret is baked in. | Must | a recorded decision on environments; an issue on custom Domains on the same zones |

*Inferred:* R-BUILD-1 and R-BUILD-3 are a de facto interface. The new adapter can define its own shape, but it has to be documented and versioned, since the reference site's deploy tool must change in step.

### Script types

| ID | Requirement | Level | Evidence |
| --- | --- | --- | --- |
| R-TYPE-1 | Middleware mode: the script renders on-demand routes and lets every other request through to the pull zone origin (storage, nearest replica), mapped to the deploy's prefix. | Must | a recorded decision on hosting; the deploy tool's request flowchart |
| R-TYPE-2 | In middleware mode a request for the storage layout itself (`/deploys/...`) never reaches storage. | Must | the deploy tool's README on verifying a deploy (`/deploys/<sha7>/robots.txt` answers 404) |
| R-TYPE-3 | A storage 404 falls through to Astro, so the 404 page and the redirect and file proxy middlewares run. | Must | the deploy tool's request flowchart (storage 404 goes to the renderer); the site's redirect and file proxy middlewares |
| R-TYPE-4 | Standalone mode (the script is the origin) with the same behavior for routes and headers. | Must (team requirement, not used by the reference site) | team brief; the alternatives in a recorded decision on hosting |

### Routing

| ID | Requirement | Level | Evidence |
| --- | --- | --- | --- |
| R-ROUTE-1 | Serve prerendered pages and on-demand routes from one build (`output: 'static'` with `prerender = false` routes) and a fully on-demand build (`output: 'server'`). | Must | the shared output and site config; route files listed below |
| R-ROUTE-2 | A file that exists in the client output wins over a dynamic on-demand route, including files written by integrations that run after the adapter (`sitemap-index.xml`, `sitemap-0.xml`, `service-worker.js`). | Must | the shared site config; a listing of the client build output |
| R-ROUTE-3 | Injected routes (`injectRoute`) and integration middleware (`addMiddleware`, order `pre`) work like file routes. | Must | the shared routes integration |
| R-ROUTE-4 | Rest and dynamic params: `[locale]`, `[locale]/[...path]`, `api/[...notFound]`, `files/[...filename]`, `api/content/[...path].md`. | Must | the site's pages directory; the shared routes integration |
| R-ROUTE-5 | `Astro.rewrite()` to an on-demand 404 page, including a query string (`/404/?locale=nl`), keeps status 404. | Must | the site's catch-all page and 404 page |
| R-ROUTE-6 | Responses returned from middleware with `X-Astro-Rewrite: true` keep their status. | Must | the file proxy middleware |
| R-ROUTE-7 | Redirects from endpoints and `Astro.redirect()` pass through unchanged (301, 302, 307, CMS-managed codes). | Must | the shared routes, the redirect middleware and the catch-all page |
| R-ROUTE-8 | Astro defaults for `base` (`/`), `trailingSlash` (`ignore`) and `build.format` (`directory`) work; directory requests resolve to `index.html`. | Must | the shared site config sets none of them; Astro's config digest in the content data store |

*Inferred:* the pain point behind `assetManifest: false` is that, in the preview build, a single-segment path like `/sitemap-index.xml` or `/service-worker.js` matches `[locale]/index.astro`, which rewrites to 404 because it is not a locale. The reference site's docs do not describe this bug in those words. `/favicon.ico` is not a file in the reference site (favicons come from the headless CMS, through the default layout), so it would correctly render the 404 page.

Not in use, verified by a search of all site source: server islands (`server:defer`), Astro actions, view transitions, Astro's `i18n` config (the reference site routes locales itself, in its own i18n middleware), `Astro.cache`.

### Headers and caching

| ID | Requirement | Level | Evidence |
| --- | --- | --- | --- |
| R-HDR-1 | Apply consumer headers to every file served from storage, so static files carry the same security baseline as rendered responses. | Must | a recorded decision on hosting; the response headers module; the reference site's security headers rule |
| R-HDR-2 | Never overwrite a header a rendered response already set, with two exceptions: a response that sets a cookie, or has a `Vary` other than `accept-encoding`, is forced to `private, no-store`, because the CDN would share it between visitors. Each exception logs the route pattern only. | Must | the security headers middleware (the reference site's middleware sets only missing ones; the adapter must not undo that) |
| R-HDR-3 | Files in Astro's assets directory (`_astro/`) are `public, max-age=31536000, immutable`; every other stored file follows the page cache policy option. | Must | the commit that set the asset cache policy; the deploy tool's README on verifying a deploy |
| R-HDR-4 | Rendered responses default to `private, no-store` unless the route sets `Cache-Control`. | Must | the deploy tool's README on how a request is served; the content API endpoint |
| R-HDR-5 | Set `Cache-Control` in a way the pull zone honors with overrides at `-1`; never rely on the zone caching private responses. | Must | the deploy tool's pull zone setup |
| R-HDR-6 | Pass Astro's CSP header (with hashes) through untouched on pages. | Must | the shared site config; the response headers module |
| R-HDR-7 | A page cache policy that allows a short shared `max-age` with `stale-while-revalidate`, and a cacheable root redirect. | Should (open) | an open performance issue on the reference site |
| R-HDR-8 | Conditional requests (`If-None-Match`, `If-Modified-Since`) to storage answer 304 cheaply. | Should | the same performance issue ("no conditional request" as a suspected cause) |

### Preview, cookies and the CMS

| ID | Requirement | Level | Evidence |
| --- | --- | --- | --- |
| R-PREV-1 | Multiple `Set-Cookie` headers survive, including attributes `HttpOnly`, `Secure`, `SameSite=None` and `Partitioned`. | Must | the draft mode and preview entry endpoints |
| R-PREV-2 | Request cookies reach on-demand routes; the build must not require the pull zone to strip cookies. | Must | the preview middleware; the deploy tool's pull zone setup |
| R-PREV-3 | `isPrerendered` is correct in middleware, so a prerendered page never reads request headers. | Must | the preview middleware; a pull request that fixed this |
| R-PREV-4 | The preview build renders every page on request with no stale cache in between (the headless CMS pushes live updates to the page). | Must | a recorded decision on the preview build; the response headers module |
| R-PREV-5 | Outbound `fetch` from the script with streamed response bodies (CMS assets proxied by `files/[...filename]` and the file proxy middleware). | Must | the files endpoint; the file proxy middleware |

### Sessions, env and secrets

| ID | Requirement | Level | Evidence |
| --- | --- | --- | --- |
| R-ENV-1 | `astro:env/server` secrets resolve at runtime from Edge Script variables and secrets: `CMS_TOKEN`, `PREVIEW_SECRET`, optional `CMS_BUILD_TRIGGER_ID`. | Must | the shared site config; the deploy tool's list of secrets |
| R-ENV-2 | Secrets are never inlined into the bundle or the manifest. | Must | a pull request that removed an old `loadEnv` workaround which inlined the token; the reference site's rule on secrets in the environment only |
| R-ENV-3 | `envField` defaults compiled at build time (`PREVIEW`, `DEPLOYMENT_IS_PRODUCTION`) still apply when the variable is absent at runtime. | Must | the shared site config; the deploy tool's deploy step (no variables passed for them) |
| R-ENV-4 | Sessions can be fully off, with no storage binding required. | Must | the shared site config |
| R-ENV-5 | Rolling back to an earlier script release works with the current variables and secrets. | Must | the consequences of a recorded decision on hosting; the reference site's rule that every deploy rolls back |

### Images and assets

| ID | Requirement | Level | Evidence |
| --- | --- | --- | --- |
| R-IMG-1 | Work with Astro's no-op image service; the reference site builds image URLs against an external image CDN itself. | Must | the image component; the reference site's performance docs |
| R-IMG-2 | Astro's fonts API (`fonts`, `astro:assets` `Font`) output is served like any `_astro/` file. | Must | the shared site config; the shared head layout |
| R-IMG-3 | An opt-in Bunny Optimizer image service. | Could | the dev server log |

### Local development

| ID | Requirement | Level | Evidence |
| --- | --- | --- | --- |
| R-DEV-1 | `astro dev` works with the adapter configured, on custom ports (4323, 4324). | Must | the reference site's agent instructions |
| R-DEV-2 | Vitest runs (`VITEST=true`) do not need the adapter's runtime. | Should | the shared site config |
| R-DEV-3 | `astro preview` serves the build locally. | Should | a commit message ("Verified locally with astro preview") |

## Reference site rules that constrain the dependency

| Rule | What it means for the adapter | Evidence |
| --- | --- | --- |
| Supported dependencies only | Published on the official npm registry, actively maintained, supports current Astro (the reference site is on `^7.3.6`) and a supported Node (the reference site builds on Node 26). No git URL or tarball install. | the reference site's rule on supported dependencies; its package manifest |
| Install without scripts | Works with `npm ci --ignore-scripts`; no postinstall step. | the reference site's deploy and CI workflows |
| No new third-party processors | The runtime calls no service other than Bunny storage and what the app itself fetches. No telemetry. | the reference site's rule on third-party processors |
| No personal data in our systems | Never logs request bodies, cookies, IP addresses or form fields; no request data stored. | the reference site's rule on personal data |
| Security headers baseline | Lets the consumer put the baseline on every response type, static files included. | the reference site's security headers rule |
| Every deploy rolls back | Builds are immutable and environment independent; nothing one-way happens at deploy. | the reference site's rule that every deploy rolls back |
| Vulnerability triage | Small dependency tree; every alert must be fixed or registered. | the reference site's rule on supported dependencies; its vulnerability register |
| Publish trigger | A recorded decision says a second De Voorhoede project on Bunny is the trigger to publish instead of vendor. | a recorded decision on hosting |

## Upcoming reference site needs (inferred)

- **Form endpoint to a CRM** (sprint 2): on-demand `POST` with a body, forwarded and not kept. Needs body passthrough and Astro's `checkOrigin` to work. Evidence: an issue comment that the form endpoint planned for sprint 2 needs a server; the reference site's discovery notes.
- **Custom Domains** (an open issue on the reference site): the same zones get the production domain, its `www` variant and a preview subdomain. The script must not assume the `b-cdn.net` hostname. A `www` and `http` redirect may land in middleware.
- **EU-only execution**: where Edge Scripts execute is an open question with bunny.net (the reference site's hosting discovery notes). Nothing for the adapter to do, but it must not add non-EU calls.

## Open questions

1. Is the build manifest plus deploy preamble (R-BUILD-1, R-BUILD-3) the interface we keep, or does the new adapter offer its own deploy command that the reference site adopts?
2. Where do the 275 ms on every HTML request go (the open performance issue on the reference site): script invocation, a storage fetch to the main region, or a missing conditional request? This decides whether R-HDR-7 and R-HDR-8 become Must.
3. Does R-ROUTE-2 hold without a build-time file list, or does the adapter need a list built after all integrations have written their files (`astro:build:done` ordering)?
4. Should the adapter type `locals.runtime` at all, given the reference site declares it but never reads it?
5. Does Bunny's Deno runtime support everything Astro 7's server bundle needs (streams, `crypto.subtle`, `node:` builtins)? The reference site uses `crypto.subtle.digest` in its preview middleware.

## Beyond the reference site: general-purpose requirements

Labeled as such; the reference site does not need these, an open source adapter does.

| ID | Requirement | Level |
| --- | --- | --- |
| G-1 | Standalone and middleware modes are both documented, tested and selected by one option with a sensible default. | Must |
| G-2 | Works without the reference site's deploy tooling: a documented way to deploy (bunny CLI or API) for both modes. | Must |
| G-3 | Non-default `base`, `trailingSlash: 'always' / 'never'` and `build.format: 'file'` behave as Astro documents. | Must |
| G-4 | Astro sessions with a Bunny-compatible driver when enabled. | Should |
| G-5 | Server islands and Astro actions work in both modes. | Should |
| G-6 | Astro's `i18n` routing config works, including fallback and domains. | Should |
| G-7 | Typed access to the Bunny request context (client IP, geo, env) through `locals`, without making it required. | Should |
| G-8 | Clear errors for unsupported Astro features and for a bundle over the size limit. | Should |
| G-9 | Semantic versioning, a changelog, a declared supported Astro and Node range, and provenance on npm publish. | Must |
| G-10 | Nothing is fetched from third parties at runtime; the package installs and works with `npm ci --ignore-scripts`. | Should |
