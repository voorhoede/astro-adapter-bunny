# astro-adapter-bunny

Run [Astro](https://astro.build/) on [bunny.net Edge Scripting](https://bunny.net/docs/scripting), as a middleware script in front of Bunny Storage or as a standalone script.

The package is not published to npm yet.

## Usage

```ts
// astro.config.ts
import { defineConfig } from 'astro/config';
import bunny from 'astro-adapter-bunny';

export default defineConfig({
  site: 'https://www.example.com',
  adapter: bunny(),
});
```

A site with no on-demand route, server island or action builds static: `dist/client` only, deployed as files.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `script` | `'middleware'` | `'middleware'` runs in front of a pull zone whose origin is Bunny Storage and reads files from storage replicas. `'standalone'` is the pull zone's origin and reads files through the Storage API, from the main region only. An Edge Script keeps the type it was created with. |
| `imageService` | `'compile'` | `'compile'` optimizes images with Sharp at build and serves on-demand images untransformed. `'passthrough'` leaves every image untransformed. `'custom'` keeps your own `image` config as it is. |
| `staticCacheControl` | `'public, max-age=0, must-revalidate'` | `Cache-Control` for stored files outside `build.assets`. A value with `s-maxage` needs a pull zone purge after every deploy. |

## What the build writes

- `dist/index.js`: the Edge Script, all server code in one plain file.
- `dist/client/`: static files and prerendered pages, with `_headers` and `_redirects` as you wrote them. No server code.
- `.bunny/build.json`: what a deploy tool needs: the script type and size, the asset folder, the pull zone settings and the variables the script reads.

## Deploying

The adapter does not deploy. A deploy tool reads `.bunny/build.json`, uploads `dist/client` to `deploys/<id>/` in the storage zone, and publishes the script with this line prepended:

```js
globalThis.__BUNNY_DEPLOY__ = { id: '<id>', assetPrefix: 'deploys/<id>' };
```

Code and files of one release then roll back together. Without the line, every request answers 500 and the log says why.

Requirements for the deploy:

- **Pull zone:** cache expiration time set to respect the origin's `Cache-Control` (`CacheControlMaxAgeOverride: -1`), cookies not stripped, Smart Cache and cache slicing off.
- **Variables:** a standalone script needs `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_HOST` and the secret `BUNNY_STORAGE_KEY`. Every server secret in your `env.schema` is listed too. `BUNNY_API_KEY` is optional and only used by `invalidate()`.
- **Purge:** purge the whole pull zone after a successful publish and after a rollback, so the cache matches the live release.

## Caching

Every response leaves with `Cache-Control`. When nothing set one:

| Response | `Cache-Control` |
| --- | --- |
| Rendered by Astro | `private, no-store` |
| Stored file under `/_astro/` | `public, max-age=31536000, immutable` |
| Other stored file, prerendered pages included | `staticCacheControl` |
| Any 500 | `private, no-store`, always |

A rendered response that sets a cookie, or has a `Vary` other than `accept-encoding`, is made `private, no-store`, since bunny.net caches it for every visitor.

`routeRules` and `Astro.cache` work on on-demand pages through a bunny.net CDN provider the adapter registers when you have none: `maxAge` becomes `public, s-maxage=<maxAge>`, and `swr` becomes `stale-while-revalidate`. `Astro.cache.invalidate({ path })` purges that URL under your `site`, with `BUNNY_API_KEY`. Invalidating by tag throws, since bunny.net did not apply tag purges to script responses.

## `_headers` and `_redirects`

`public/_headers` and `public/_redirects` follow [Cloudflare's semantics](https://developers.cloudflare.com/pages/configuration/headers/) and apply to stored files only. Rendered pages set their own headers in Astro middleware.

- What Astro sets per page wins over `_headers`; `_headers` may set `Cache-Control`.
- `_redirects` covers paths no on-demand route claims. Put a redirect from a dynamic route's path in Astro's `redirects` config.
- A `_redirects` rule keeps the visitor's query, unless the target has its own.
- In a static build the deploy tool turns both files into pull zone edge rules. A pull zone takes 50, and the build warns above that.

## Known limits

- **Script size:** the build warns above 7 MB and fails above 10 MB, naming the five largest packages. Where between 7 and 10 MB bunny.net stops starting a script is not measured.
- **Shiki:** one `<Code>` from `astro:components` adds about 11 MB of server code, every Shiki language and theme. A site that never highlights code at runtime can alias Shiki out. Markdown code blocks are highlighted at build and are not affected.
- **Prism:** `<Prism>` and `syntaxHighlight: 'prism'` fail in on-demand routes, since Prism loads its languages by a path computed at runtime. Prerendered pages work.
- **Node builtins:** `node:child_process`, `node:vm`, `node:worker_threads`, `node:constants` and `node:path/win32` fail the build, since bunny.net does not start a script that imports them.
- **Sessions:** no default driver. Bring an unstorage driver that works over HTTP.
- **i18n domains** are not supported.
- **Extensionless public files** such as `/CNAME` are looked up as `CNAME/index.html` and not found.

## Preview

`astro preview` runs the built script locally against `dist/client`, behind a stand-in for the pull zone.

## License

[ISC](license.md)
