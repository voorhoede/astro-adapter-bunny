---
status: accepted (`Set-Cookie` and `Vary` rule, `staticCacheControl` default, default cache provider); proposed (the rest)
date: 2026-10-28, updated 2026-10-30
---

# Every response leaves with Cache-Control

## Context and problem statement

Measured on bunny.net in October 2026:

- With `CacheControlMaxAgeOverride: -1`, a pull zone caches a script response without `Cache-Control` as `public, max-age=2592000`, middleware short-circuits included. With the default of a storage-origin zone (2592000) it caches everything for 30 days, `private` included, and one visitor's cookie page was served to another.
- Storage sends no `Cache-Control` of its own.
- Cookies are never part of the cache key, and the zone ignores `Vary`: a cacheable response with `Vary: cookie` was cached and served to everyone, and the `Vary` header was stripped.
- The zone does not read `CDN-Cache-Control` in either direction.
- `public, max-age=0, s-maxage=300` from a script is not cached, and the visitor gets `Cache-Control: no-cache` instead. `public, s-maxage=300` is cached and reaches the visitor unchanged.

## Considered options

- **Leave headers to the app.** One forgotten header caches a personal page for a month.
- **Rely on pull zone settings.** The adapter does not own the zone.
- **The adapter sets a default on every response it emits, never replacing one the app set, with two named exceptions.**

## Decision outcome

`caching.finalize` runs on every exit of both script types and is a pure function. Proposed: that includes storage 401, 403 and 5xx answers and every catch block.

| Response | `Cache-Control` when none is set |
| --- | --- |
| Rendered (page, endpoint, redirect, error page rendered by Astro) | `private, no-store` |
| Stored file under `build.assets` | `public, max-age=31536000, immutable` (always) |
| Other stored file, prerendered HTML and a `404.html` served for not found included | `staticCacheControl` |
| Any 500: the adapter's own, a rendered one, or a prerendered `500.html` | `private, no-store`, always (proposed) |

- **`staticCacheControl` (accepted).** Default `public, max-age=0, must-revalidate`. A consumer may opt into `s-maxage`, which needs a purge on publish and on rollback.
- **Two exceptions (accepted).** A rendered response is forced to `private, no-store` when it sets a cookie, or when it has any `Vary` other than `accept-encoding`. Each logs one line with the route pattern only, never a URL, query or value. A cached `Set-Cookie` leaks a session; a cached `Vary: cookie` page is served to everyone.
- **`_headers`** applies to stored files only and may set `Cache-Control` there, as on other platforms; it beats the defaults above, the immutable one under `build.assets` included, and only a 5xx stays `private, no-store`. Astro's per-page headers beat `_headers`.
- **Default cache provider (accepted).** When the project has none, the adapter registers a bunny.net CDN provider, so `routeRules` and `Astro.cache` work on on-demand pages. `maxAge` becomes `public, s-maxage=<maxAge>`, plus `stale-while-revalidate=<swr>`, and never `max-age=0`, which bunny.net does not cache. `invalidate({ path })` purges that URL under the Astro `site` through `POST https://api.bunny.net/purge?url=...` with `BUNNY_API_KEY`, which the deploy tool sets as a script secret; without the key or the `site` it throws a clear error. `invalidate({ tags })` throws: measured on 2026-11-03 on a standalone script with a one-day `s-maxage`, a tag purge (`purgeCache` with `CacheTag`) had not taken effect after 5 minutes, while a URL purge and a full zone purge each took effect within 30 s.
- **Later, not in version 1.** Astro's per-page `Cache-Control` on prerendered pages; no official adapter forwards it.
- Astro's CSP header on rendered pages passes untouched.

### Consequences

- Good: no path leads to an accidental 30-day cache.
- Good: one function, tested as a table.
- Bad: "the app owns rendered headers" has two exceptions, which a reader must know about; the log line says why.
- Bad: `max-age=0` pages revalidate at storage on every request by default.
- Bad: correctness still depends on the zone override being `-1`, which the adapter can only document.

### Confirmation

`finalize` is tested as a table, both exceptions, the 500 rows and storage error statuses included. The test harness fails any response without `Cache-Control`. A deployed test app shows `CDN-Cache: HIT` on a second request only for the rows that should be cached.
