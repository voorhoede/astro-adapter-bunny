---
status: accepted; open (invalidating by tag)
date: 2026-10-28, updated 2026-11-04
---

# Cache-Control on every response, and a CDN cache provider

## Context and problem statement

Measured on bunny.net between October and November 2026:

- With `CacheControlMaxAgeOverride: -1`, a pull zone caches a script response without `Cache-Control` as `public, max-age=2592000`, middleware short-circuits included. With the default of a storage-origin zone (2592000) it caches everything for 30 days, `private` included, and one visitor's cookie page was served to another.
- Storage sends no `Cache-Control` through the Storage API, but through the CDN it hands the response hook `Cache-Control: max-age=25600000` (2026-11-03).
- Cookies are never part of the cache key, and the zone ignores `Vary`: a cacheable response with `Vary: cookie` was cached and served to everyone, and the `Vary` header was stripped.
- The zone does not read `CDN-Cache-Control` in either direction.
- `public, max-age=0, s-maxage=300` from a script is not cached, and the visitor gets `Cache-Control: no-cache` instead. `public, s-maxage=300`, with or without `stale-while-revalidate`, is cached and reaches the visitor unchanged.
- On a standalone script with a one-day `s-maxage`, a full zone purge and a URL purge each took effect within 30 s, while a tag purge (`purgeCache` with `CacheTag`, matching the response's `CDN-Tag`) had not taken effect after 5 minutes (2026-11-03).

## Considered options

- **Leave headers to the app.** One forgotten header caches a personal page for a month.
- **Rely on pull zone settings.** The adapter does not own the zone.
- **Set a default on every response the script sends, never replacing one already set, with two named exceptions.**

## Decision outcome

The third. `caching.finalize` runs on every exit of both script types, storage errors and caught throws included, and is a pure function. When a response has no `Cache-Control`:

| Response | `Cache-Control` |
| --- | --- |
| Rendered by Astro (page, endpoint, redirect, error page) | `private, no-store` |
| Stored file under `build.assets` | `public, max-age=31536000, immutable` |
| Other stored file, prerendered pages and a stored 404 page included | `staticCacheControl` |
| Any 500 | `private, no-store`, always |

- **`staticCacheControl`** defaults to `public, max-age=0, must-revalidate`. A value with `s-maxage` needs a zone purge after every publish and rollback.
- **Stored files** drop the `Cache-Control` storage hands the response hook, so only `_headers` or the defaults above apply.
- **Two exceptions.** A rendered response is forced to `private, no-store` when it sets a cookie, or when it has any `Vary` other than `accept-encoding`. Each logs one line with the route pattern only, never a URL, query or value. A cached `Set-Cookie` leaks a session; a cached `Vary: cookie` page is served to everyone.
- **Default cache provider.** When the project has none, the adapter registers a bunny.net CDN provider, so `routeRules` and `Astro.cache` work on on-demand pages. Astro keeps a provider's headers through `app.render()` (verified with Astro 7.4.2). `maxAge` becomes `public, s-maxage=<maxAge>`, `swr` becomes `stale-while-revalidate=<swr>`, and `max-age=0` is never sent.
- **`invalidate({ path })`** purges that URL under the Astro `site` through `POST https://api.bunny.net/purge?url=...` with `BUNNY_API_KEY`. Without the key or the `site` it throws a clear error. **`invalidate({ tags })`** throws, since tag purges did not take effect on script responses.
- Astro's CSP header on rendered pages passes untouched.

### Consequences

- Good: no path leads to an accidental 30-day cache.
- Good: one function, tested as a table.
- Bad: "the app owns rendered headers" has two exceptions a reader must know about; the log line says why.
- Bad: `max-age=0` pages revalidate at storage on every request by default.
- Bad: correctness depends on the zone override being `-1`, which the adapter can only document.
- Open: invalidating by tag, until bunny.net applies tag purges to script responses.

### Confirmation

`finalize` is tested as a table, both exceptions, the 500 rows and storage errors included, and the test harness fails any response without `Cache-Control`. The provider's headers and `invalidate()` are tested against a fake purge API. On bunny.net, a `routeRules` page from the test app was cached by the CDN with the provider's header (2026-11-03).
