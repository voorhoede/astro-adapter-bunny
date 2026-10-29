---
status: accepted (`Set-Cookie` and `Vary` rule, `staticCacheControl` default); proposed (the rest)
date: 2026-10-28
---

# Every response leaves with Cache-Control

## Context and problem statement

With `CacheControlMaxAgeOverride: -1`, bunny caches a script response without `Cache-Control` as `public, max-age=2592000`, middleware short-circuits included. With the storage-origin default (2592000) it caches everything 30 days, `private` included; one visitor's cookie page was served to another (bunny research). Storage sends no `Cache-Control` of its own. Cookies are never part of the cache key (measured), and the zone ignores `Vary`: a cacheable response with `Vary: cookie` was cached and served to everyone, and the `Vary` header was stripped (S1 step 7, measured).

## Considered options

- **Leave headers to the app.** One forgotten header caches a personal page for a month.
- **Rely on pull zone settings.** The adapter does not own the zone.
- **The adapter sets a default on every response it emits, never replacing one the app set, with two named exceptions.**

## Decision outcome

`caching.finalize` runs on every exit of both script types, and is a pure function. Proposed: that includes storage 401, 403 and 5xx answers and every catch block.

| Response | `Cache-Control` when none is set |
| --- | --- |
| Rendered (page, endpoint, redirect, error page rendered by Astro) | `private, no-store` |
| Stored file under `build.assets` | `public, max-age=31536000, immutable` (always) |
| Other stored file, prerendered HTML and a `404.html` served for not found included | `staticCacheControl` |
| Any 500: the adapter's own, a rendered one, or a prerendered `500.html` read through the error hook | `private, no-store`, always (proposed) |

- **`staticCacheControl` (accepted).** Default `public, max-age=0, must-revalidate`. A consumer may opt into `s-maxage`; the README says that needs a purge on publish and on rollback.
- **Exceptions to R-HDR-2 (accepted).** A rendered response is forced to `private, no-store` when it sets a cookie, or when it has any `Vary` other than `accept-encoding`. Each logs one line with the route pattern only, never a URL, query or value. A cached `Set-Cookie` leaks a session; a cached `Vary: cookie` page is served to everyone.
- **`_headers` (ADR 0008)** applies to stored files only and may set `Cache-Control`, as on every other platform; it beats the defaults above, and only a 5xx stays `private, no-store`. Astro's per-page headers beat it.
- **Cache provider (accepted).** The adapter registers a bunny.net CDN provider by default when the project has none, so `routeRules` and `Astro.cache` work on on-demand pages: `Cache-Control` with `s-maxage`, `CDN-Tag`, and `invalidate()` through the purge API with `BUNNY_API_KEY`, which the deploy tool sets as a script secret. Without the key, `invalidate()` throws a clear error. The open bunny.net checks (s-maxage with max-age=0, `CDN-Tag` on script responses, purge speed) run before it ships.
- **Later, not in v1.** Astro's per-page `Cache-Control` on prerendered pages: no official adapter forwards it. Rendered responses own their headers, and the adapter never overwrites one there beyond the two exceptions.
- Astro's CSP header on rendered pages passes untouched (R-HDR-6).

### Consequences

- Good: no path leads to a 30-day accidental cache.
- Good: one function, tested as a table.
- Bad: R-HDR-2 now has two exceptions, which a reader must know about; the log line says why.
- Bad: `max-age=0` pages revalidate at storage on every request by default, the suspected cause of an open performance issue on the reference site.
- Bad: correctness still depends on the zone override being `-1`, which the adapter can only document.

### Confirmation

M1 tests `finalize` as a table, including both exceptions, the 500 rows and storage error statuses. The harness fails any response without `Cache-Control`. S1 step 7 checks live that `Set-Cookie` with `public, max-age` and `Vary: cookie` with `s-maxage` would be shared without the rule, and whether Bunny reads `CDN-Cache-Control`. M4 checks `CDN-Cache` on a second request for each row.
