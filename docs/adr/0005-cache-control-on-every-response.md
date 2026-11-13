---
status: accepted; open (a cache provider for routeRules, Vary)
date: 2026-10-28, rewritten 2026-11-10
---

# Cache-Control on every response

## Context and problem statement

Astro sets no `Cache-Control` on a rendered response unless the page does, and storage sends none through the pull zone that the adapter keeps. Measured on bunny.net between October and November 2026:

- **Smart Cache**, a pull zone setting, replaced every `Cache-Control` on HTML and JSON with `no-cache`: a page setting `public, max-age=60`, `public, s-maxage=60` or `CDN-Cache-Control: max-age=60` went to the visitor as `no-cache`, and two requests for the same URL both reached the script (2026-11-09). bunny.net's documentation says Smart Cache caches by extension and MIME type, and never `text/html`, `application/json` or `application/xml`.
- **Without Smart Cache**, a response with no `Cache-Control` was cached for 30 days, `public, max-age=2592000`, and served to every visitor: an on-demand JSON endpoint answered the same time twice. A pull zone created through the API also had its cache expiration fixed at 30 days (`CacheControlMaxAgeOverride: 2592000`), which overrode every header the script set, until it was set to respect the origin (`-1`). The same zone ignored query strings, so every query got the first cached response.
- **Disable cookies**, a pull zone setting that a zone created by bunny.net's CLI had on, stripped every `Set-Cookie`.
- **A response that sets a cookie** was not cached, even with `public, max-age=60`: three requests for the same URL answered three different cookies (2026-11-10).
- **A 500, a 404 or a redirect** answered by the pull zone came with `no-cache` from bunny.net, with `CacheErrorResponses` off.
- **`Vary` is ignored.** A response with `public, max-age=60` and `Vary: cookie` was cached for one visitor's cookie and served to a visitor with another, and the `Vary` header was stripped (2026-11-10).
- **`routeRules`** set no header without a cache provider, and with Astro's `memoryCache()` only an in-memory cache in the script (Astro 7.4.5, 2026-11-10).
- On a script with a one-day `s-maxage`, a full zone purge and a URL purge each took effect within 30 s, while a tag purge (`CacheTag` against the response's `CDN-Tag`) had not after 5 minutes (2026-11-03).

## Considered options

- **Leave headers to the app.** One forgotten header caches a personal page for a month.
- **Pull zone edge rules per path.** They only see the path, not whether a response was rendered or sets a cookie, and live outside the repository.
- **Set a default in the script when a response has none, and require four pull zone settings.**

## Decision outcome

The third.

| Response | `Cache-Control` |
| --- | --- |
| Stored file under `build.assets` | `public, max-age=31536000, immutable` |
| Any other stored file, prerendered pages included | `public, max-age=0, must-revalidate` |
| Rendered by Astro, without its own `Cache-Control` | `private, no-store` |
| Rendered by Astro, with its own `Cache-Control` | kept as it is |

- **The pull zone must have** Smart Cache off, cache expiration set to respect the origin, query strings not ignored, and cookies not disabled.
- **No rule for cookies or errors.** bunny.net does not cache a response that sets a cookie, and does not cache error responses unless the zone is told to. A site that turns `CacheErrorResponses` on chooses to cache errors.
- **No cache provider.** `routeRules` and `Astro.cache` do nothing at the CDN; a page sets its own `Cache-Control` instead.
- **A static site without a script** gets the same headers from two pull zone edge rules: URL `*/_astro/*` sets `Cache-Control: public, max-age=31536000, immutable`, and any other URL sets `public, max-age=0, must-revalidate`. Its storage zone sets `Custom404FilePath` to `/404.html`. Without them, storage answered every file with `max-age=25600000` and bunny.net's own 404 page (2026-11-13). Path rules are enough there, since every response is a stored file.

### Consequences

- Good: no rendered page is cached unless it asks to be, and a page's own header works.
- Good: hashed assets are cached for a year, and a deploy shows other files at once.
- Bad: every stored file other than hashed assets revalidates at storage on every request.
- Bad: a page that sets a `public` header and varies by cookie is served to the wrong visitor, since the zone ignores `Vary`.
- Bad: correctness depends on four pull zone settings the adapter cannot set, and for a static site on two edge rules and a storage zone setting as well.
- Open: a cache provider, and invalidating by tag.

### Confirmation

On bunny.net with the four settings: a rendered page without a header answers `private, no-store` and is never cached, a page with `public, max-age=60` keeps it and is cached on the second request, `/_astro/*` answers a year immutable, and other stored files `max-age=0, must-revalidate`.
