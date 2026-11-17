# Feature checklist

Every Astro 7 feature that matters to this adapter, split into **base** (a fresh `npm create astro` app or a typical site uses it without opting in) and **extra** (opt-in config or an API most sites do not use).

Status of this adapter:

- ✅ works, checked live on bunny.net
- 🟡 works partly, or works but untested
- ❌ not supported yet
- ⛔ blocked or limited by the bunny.net platform
- ➖ nothing for an adapter to do

Columns for prior art: **Astro** is the official adapters (Node, Vercel, Netlify, Cloudflare), **Bunny** the official bunny.net adapter, **Old** this repo before the rewrite, **Ref** the reference site's adapter.

## Base

| Feature | Status | Notes | Astro | Bunny | Old | Ref |
| --- | --- | --- | --- | --- | --- | --- |
| On-demand pages and endpoints | ✅ | | all | yes | yes | yes |
| Dynamic and catch-all routes | ✅ | | all | yes | yes | yes |
| Prerendered pages, `build.format: 'directory'` | ✅ | | all | yes | yes | yes |
| `build.format: 'file'` | ✅ | The script rewrites a request for a prerendered page to its `.html` file, so `/about` and `/about/` serve `about.html`. | Node; Vercel forces directory | yes | yes | only with file list |
| Fully static site | ✅ | Builds `dist/client` only, no script; with `server:defer` it still gets one. Served live by a pull zone on the storage zone, with `Custom404FilePath: /404.html` and two edge rules for `Cache-Control`. | all | yes | yes | yes |
| `public/` files and `/_astro/*` | ✅ | `/_astro/*` gets one year immutable. | all | yes | yes | yes |
| Files without extension (`/CNAME`) | ✅ | Served as stored, with `directory`, `file` and `preserve`. | Node yes | yes, with file list | no | yes, with file list |
| Files written after the build (sitemap, service worker) | 🟡 | Served from storage, unless an on-demand route matches the same path: `/docs/late.txt` renders `docs/[...path]`, not the file. | n/a | breaks with file list | yes, storage first | breaks with file list |
| On-demand `404.astro` | ✅ | | all | yes | yes | yes |
| Prerendered `404.astro` | ✅ | From storage through `Custom404FilePath`, which the deploy tool sets. A POST to a missing path still answers empty. | Node, Cloudflare read it directly | yes | yes | yes |
| On-demand `500.astro` | ✅ | | all | yes | yes | yes |
| Prerendered `500.astro` | ❌ | Answers an empty 500, like the prerendered 404. | Node, Cloudflare | yes | untested | yes |
| `redirects` to an on-demand route | ✅ | Real 301/308. | all | yes | yes | yes |
| `redirects` to a prerendered page | ✅ | Real 301/308 from the script (`build.redirects: false`). `dist/_redirects` lists them for edge rules, which a static site needs from its deploy tool. | all real | real | real | real |
| `Astro.redirect()` | ✅ | | all | yes | yes | yes |
| `Astro.rewrite()` to an on-demand page | ✅ | Also to an on-demand `/404`. | all | yes | yes | yes |
| `Astro.rewrite()` to a prerendered page | ❌ | Answers 500: the page is not in the script. | untested | throws on prerendered 404 | untested | throws on prerendered 404 |
| Injected routes (`injectRoute()`) | ✅ | | all | yes | yes | yes |
| `trailingSlash` | ✅ | The script redirects stored paths to the configured form, as Astro does for rendered ones. A static site needs edge rules; `'never'` with a query string loops there. | Node, Vercel | no | yes | no |
| Cookies | ✅ | Needs the pull zone's "disable cookies" off. | all | yes | yes | yes |
| Middleware and `Astro.locals` | ✅ | | all | yes | yes | yes |
| `Astro.url` and the origin check on POST | ✅ | Over http and https. | all | pass-through | yes | yes |
| Methods other than GET/HEAD on files | ✅ | Answers 405 with `Allow: GET, HEAD` on a stored file or prerendered route, like storage itself; a missing path answers the 404 page. | Node: falls through | 405 | render | 405 |
| `Astro.clientAddress` | ✅ | From `x-real-ip`, falling back to `x-forwarded-for`. bunny.net overwrites both, so a visitor cannot spoof them. | all | yes | yes | yes |
| HTML streaming | ✅ | First byte after 0.1 to 0.3 s, the slow part after 2.3 s. | all | untested | untested | untested |
| `<Image>` on prerendered pages (Sharp at build) | ✅ | | all | yes | yes | no-op |
| `<Image>` on on-demand pages (`/_image`) | 🟡 | Serves the original with `content-type: image/undefined`. | all, Sharp or image CDN | original (no-op) | original | original |
| Content collections | ✅ | Prerendered list and on-demand entries. | ➖ | untested | untested | untested |
| `import.meta.env` at runtime | ✅ | Inlined at build, as Astro does. `process.env` reads script variables at runtime. | all | yes | yes | yes |
| Range requests | ✅ | The pull zone answers 206 with the right bytes, also on a cache miss. `.svg` answered 200 with the whole file. | Node yes | yes | no | yes |
| Conditional requests (`If-None-Match`) | 🟡 | Stored files carry an `ETag` and `Last-Modified`, but a matching `If-None-Match` or `If-Modified-Since` still answered 200 with the body. | Node yes | yes | no | yes |
| Path traversal (`/..%2f..%2f`) | ✅ | bunny.net answers 400 before the script. | all | yes | yes | yes |
| Request bodies | ✅ | A 100 MB POST reached an endpoint and came back. Astro limits actions and server islands to 1 MB itself. | Node limits to 1 GiB | untested | untested | untested |
| Compression | ✅ | gzip on HTML and JSON, from the pull zone. No brotli. | platform | | | |
| Content type for unknown extensions | ❌ | `site.webmanifest` answered `application/octet-stream` through the pull zone. | n/a | from extension | from extension | from extension |
| Storage zone shielded from visitors | ✅ | With deploy folders: an edge rule blocks `/deploys/*` with 403. A deploy to the root stays readable. | n/a | n/a | deploy folder, reserved paths | deploy folder |
| Cache-Control defaults | ✅ | Rendered `private, no-store`, files `max-age=0, must-revalidate`. | all | yes | yes | yes |
| `astro dev` | ✅ | | all | yes | yes | yes |
| `astro preview` | ❌ | No preview entrypoint. | Node, Cloudflare | yes | yes | yes |
| Script size check | ❌ | No warning at 7 MB or failure at 10 MB. ⛔ see platform limits. | n/a | warn 7.5, fail 10 MB | warn 7, fail 10 MB | warn 7.5, fail 10 MB |
| Refusing Node builtins that break the script | ❌ | ⛔ see platform limits. | n/a | aliases bare names | fails the build | aliases bare names |

## Extra

| Feature | Status | Notes | Astro | Bunny | Old | Ref |
| --- | --- | --- | --- | --- | --- | --- |
| `base` | ✅ | The deploy tool uploads under the base, so stored paths match the URLs. A redirect target gets no base, as in Astro. | all | yes | yes | yes |
| `build.format: 'preserve'` | ✅ | Like `file`, except index routes, which the pull zone resolves to `index.html`. | Node | no | yes | no |
| `build.assetsPrefix` | ➖ | | | | | |
| `astro:env` secrets | ✅ | Script variables. | all | yes | yes | yes |
| Server islands | ✅ | Needs a fixed `ASTRO_KEY` across releases. | all | yes | yes | yes |
| Actions | ✅ | Form action and JSON call to `/_actions/*`. | all | tested | untested | untested |
| Sessions | ❌ | No default driver. ⛔ Storage is a weak session store. | Node, Netlify, Cloudflare | Storage driver | none | Storage driver |
| `routeRules` and `Astro.cache` | ❌ | No cache provider, so no CDN headers. | Vercel, Netlify, Cloudflare | yes | yes | yes |
| `Astro.cache.invalidate()` | ❌ | ⛔ tag purges did not take effect on script responses. | Vercel, Netlify, Cloudflare | path and tag | path only | path and tag |
| CSP (`security.csp`) on prerendered pages | 🟡 | Ends up in a `<meta>` tag; `staticHeaders` is not declared. | Node, Vercel, Netlify | headers | meta only | headers |
| Extra headers on stored files | ❌ | No `headers` option and no `_headers`. | platform files | `headers` option | `_headers` | `headers` option |
| `public/_headers` and `_redirects` | ❌ | ⛔ bunny.net has no such feature. | Netlify, Cloudflare | static builds only | parsed by the script | static builds only |
| i18n routing and fallback | ✅ | Fallback to an on-demand page is a 302. Fallback to a prerendered page is a meta refresh page with 200: `build.redirects: false` leaves fallbacks alone. | all | tested | partly | custom routing |
| `i18n.domains` | ❌ | Declared unsupported. A build with domains completes without a warning; runtime untested. | Node, Vercel, Cloudflare | untested | unsupported | untested |
| `Astro.preferredLocale` | ✅ | From `Accept-Language`. | all | | | |
| `astro:env` public server variables | ✅ | Inlined at build: a script variable with the same name did not change the value. | all | | | |
| `astro:env` public client variables | ✅ | Inlined at build. | all | | | |
| `env.validateSecrets` | ✅ | The build fails without the secret in its environment, and never writes the value into the script. At runtime a missing secret answers 500 on rendered pages; stored files still serve. | all | | | |
| Remote images (`image.remotePatterns`) | 🟡 | `/_image` fetches and serves the original, with `content-type: image/undefined`. | all | | | |
| A project's own `image.service` | ❌ | The adapter always sets Sharp at build and no-op at runtime, so a custom service is lost. Kept simple on purpose for now. | Cloudflare and Netlify respect `custom` | `false` keeps it | `custom` keeps it | `false` keeps it |
| A project's own `vite.ssr` settings | ✅ | Merged through `updateConfig`. With its own `noExternal` and `resolve.conditions`, the script still gets the Deno variant of the SDK. | merge | merge | merge | merge |
| Custom fetch entrypoint (`src/fetch.ts`, Astro 7) | ✅ | Runs for rendered requests. | untested | | | |
| Live content collections | ✅ | A fresh value on every request. | | | | |
| `logger` config and script logs | 🟡 | Untested: bunny.net shows script logs in its dashboard only, not through the API. | Node, Vercel | | | |
| Custom `outDir` | ✅ | The script lands in `<outDir>/index.js`, the files in `<outDir>/client`. `build.client` and `build.server` untested. | all | | | |
| `experimental.redirectPage` (`src/pages/3xx.astro`) | 🟡 | Works when `3xx.astro` sets `prerender = true`. With `output: 'server'` and without it, the build falls back to Astro's own page. | | | | |
| `security.allowedDomains` | ➖ | The script takes the host from `Host`. A request with `X-Forwarded-Host: evil.example` kept the real host in `Astro.url`. | all | | | |
| Image service at runtime (Bunny Optimizer) | ⛔ | Optimizer answered 523 on script-backed pull zones. | Vercel, Netlify, Cloudflare | option, warns | no | option, unusable |
| Storage regions and replicas | ✅ | The pull zone reads from the storage zone and its replicas. | n/a | `storageHost` | `BUNNY_STORAGE_HOST` | replicas |
| Deploy folders and rollback | ✅ | Edge rules serve `deploys/<id>` and name it in `X-Bunny-Deploy`; the script strips the folder. Optional. | n/a | `__BUNNY_DEPLOY__` | `__BUNNY_DEPLOY__` | `__BUNNY_DEPLOY__` |
| Build manifest for deploy tooling | ✅ | `.bunny/build.json` in bunny.net's shape, `type: "middleware"`, our fields under `astroAdapterBunny`. Untested with bunny.net's CLI. | n/a | `.bunny/build.json` | `.bunny/build.json` | `.bunny/build.json` |
| `waitUntil` and platform context in `locals` | ❌ | | Cloudflare, Netlify | `locals.runtime` | no | `locals.runtime` |
| Fonts API | ✅ | A local font served from `/_astro/fonts/` as `font/woff2`. | ➖ | | | used |
| Edge middleware mode | ➖ | Middleware runs inside the script. | Vercel, Netlify | no | no | no |

## Adapter contract

What the adapter declares to Astro through `setAdapter()`, from the [adapter reference](https://docs.astro.build/en/reference/adapter-reference/).

### `supportedAstroFeatures`

| Key | Declared | Status | Notes | Astro |
| --- | --- | --- | --- | --- |
| `staticOutput` | `stable` | ✅ | A fully static site builds without a script. | all stable |
| `hybridOutput` | `stable` | ✅ | | all stable |
| `serverOutput` | `stable` | ✅ | | all stable |
| `envGetSecret` | `stable` | ✅ | `getSecret()` reads script variables. | all stable |
| `sharpImageService` | `limited` | 🟡 | Sharp at build only. The build logs a warning; an object with a `message` could say why. | Cloudflare limited, others stable |
| `i18nDomains` | `unsupported` | ❌ | Needs the visitor host per domain and no prerendered pages. Untested. | Node, Vercel, Cloudflare experimental |

### `adapterFeatures`

| Key | Declared | Status | Notes | Astro |
| --- | --- | --- | --- | --- |
| `middlewareMode` | not set (`classic`) | ✅ | Astro middleware runs inside the script. `edge` needs a separate function, which bunny.net does not have. | Vercel, Netlify offer `edge` |
| `buildOutput` | follows the project | ✅ | Passed back from `astro:config:done`; the script is only bundled when `astro:build:ssr` runs. | Node `server`, others follow the project |
| `staticHeaders` | not set (`false`) | ❌ | Astro keeps the CSP of prerendered pages in a `<meta>` tag. With it on, Astro hands `routeToHeaders` to the adapter, which could add them to stored files in the response hook. | Node, Vercel, Netlify |
| `preserveBuildClientDir` | `true` | ✅ | Static builds also write to `dist/client`, so every deploy uploads the same folder. | Cloudflare |
| `preserveBuildServerDir` | `true` | ✅ | Keeps the server entry of a static site with `server:defer` in `dist/server`, out of the files. | Vercel, Cloudflare |

### Other keys

| Key | Set | Status | Notes | Astro |
| --- | --- | --- | --- | --- |
| `entrypointResolution` | `auto` | ✅ | | all `auto` |
| `serverEntrypoint` | `astro-adapter-bunny/script.ts` | ✅ | | all |
| `previewEntrypoint` | not set | ❌ | `astro preview` does not work. | Node, Cloudflare |
| `client.internalFetchHeaders`, `client.assetQueryParams` | not set | ❌ | Used for skew protection, so a page from one release does not load assets or islands from another. Relevant, since files sit in the zone root. | Vercel opt-in, Netlify automatic |
| Custom prerenderer (`setPrerenderer()`) | not set | ➖ | Prerendering runs in Node, which works. | Cloudflare (workerd) |
| `args`, `exports` | not set | ➖ | Deprecated. | |

## Platform limits

- ⛔ **Script size and startup:** 10 MB maximum and a 500 ms startup budget. Around 7.5 to 7.8 MB a script stopped starting and answered 400. One `<Code>` component adds about 11 MB of Shiki.
- ⛔ **No `import()` at runtime:** every specifier tried failed, so all code must be in one file.
- ⛔ **Node builtins:** only `node:` names resolve. `child_process`, `vm`, `worker_threads`, `constants` and `path/win32` make the script answer 400 on every request. `node:fs` is empty per isolate.
- ⛔ **No native binaries:** Sharp cannot run at runtime.
- ⛔ **Bunny Optimizer** answers 523 on script-backed pull zones.
- ⛔ **50 subrequests per request**, 128 script variables of at most 2 KB each.
- ⛔ **Storage as session store:** main region only, no conditional writes, no expiry.
- ⛔ **Purging by tag** did not take effect on script responses; full zone and URL purges did.
- ⛔ **Pull zone defaults that break Astro:** Smart Cache on, a fixed cache expiration, "disable cookies" on. Each must be changed per zone.
- ⛔ **`Vary` is ignored:** a public response with `Vary: cookie` was cached for one cookie and served to a visitor with another, and the `Vary` header was stripped. A response that sets a cookie was not cached.
- ⛔ **No `_headers` or `_redirects`** in bunny.net itself, and a pull zone takes 50 edge rules.
- ⛔ **Case-insensitive storage:** `/FAVICON.SVG` answered the file stored as `favicon.svg`.
- ⛔ **CORS on stored files:** the pull zone adds `access-control-allow-origin: *` to files with extensions such as `.webp`, `.css` and `.js` (`EnableAccessControlOriginHeader`).
