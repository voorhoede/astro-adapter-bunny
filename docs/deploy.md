# Deploy specification

What a deploy tool has to do to publish a site built with this adapter. The adapter only builds; everything below happens outside the build.

Status: the redirects file is planned and not written by the adapter yet. Everything else describes the current build.

## Build output

| Path | When | What it is |
| --- | --- | --- |
| `dist/client/` | always | Every file the site serves: prerendered pages, `public/` files and `/_astro/*` assets. |
| `dist/index.js` | only when the site has a server | The Edge Script, one plain ES module. A fully static site has none. |
| `dist/_redirects` | when the project has `redirects` (planned) | Astro's redirects in the `_redirects` format, outside `dist/client` so it is not uploaded. |
| `dist/server/` | sometimes | Astro's own server build. Not deployed. |

A custom `outDir` replaces `dist`.

## Resources

- **A storage zone** that holds `dist/client`.
- **A pull zone** with that storage zone as its origin.
- **A middleware Edge Script** attached to that pull zone, only for sites with `dist/index.js`. A script keeps the type it was created with, so it has to be created as a middleware script, not a standalone one.

## Release steps

1. **Build** with a fixed `ASTRO_KEY` in the environment. Astro encrypts server island props with a key made per build; without a fixed key, a page cached from one release breaks the islands of the next.
2. **Upload `dist/client`** to the root of the storage zone, keeping paths.
3. **Publish `dist/index.js`** to the Edge Script, when it exists.
4. **Remove stored files the build no longer has.** The script asks storage first for every GET and HEAD, so a file left over from an earlier build wins over an on-demand route on the same path, and stays publicly readable.
5. **Apply the redirects** as edge rules (see below).
6. **Purge the pull zone.** A full zone purge took effect within 30 seconds. A tag purge against a script response had not taken effect after 5 minutes.

Uploading before publishing means new hashed assets exist before a new script or page asks for them. Removing after publishing means the old release keeps working until the new one is live.

## Pull zone settings

Required for every site:

| Setting | Value | Why |
| --- | --- | --- |
| Smart Cache | off | It replaces every `Cache-Control` on HTML and JSON with `no-cache`. |
| Cache expiration | respect the origin (`CacheControlMaxAgeOverride: -1`) | Otherwise a fixed time overrides every header the script sets. A zone created through the API had 30 days. |
| Query strings | not ignored | Otherwise every query gets the first cached response. |
| Disable cookies | off | It strips every `Set-Cookie`. |

Leave "cache error responses" off, unless the site wants errors cached.

## Static sites

A site without `dist/index.js` has no script to set headers or answer 404s, so the zones take over:

- **Storage zone:** `Custom404FilePath` set to `/404.html`, when the build has one.
- **Edge rule:** URL `*/_astro/*` sets the response header `Cache-Control: public, max-age=31536000, immutable`.
- **Edge rule:** any URL that does not match `*/_astro/*` sets `Cache-Control: public, max-age=0, must-revalidate`.

Without these, storage answered every file with `max-age=25600000`, and a missing path with bunny.net's own 404 page. When `build.assets` is not `_astro`, use that folder name.

A site with a script must not get these rules: the script sets `Cache-Control` itself.

## Redirects

The adapter will set `build.redirects: false`, so Astro writes no meta refresh pages, and the deploy tool turns `dist/_redirects` into edge rules. Without them, a redirect answers 404. Each line has a source, a target and a status:

```
/old /about 301
/old-blog/:slug /blog/:slug 301
/moved/* /docs/:splat 301
```

Translate each line into one edge rule with the action "Redirect to URL":

| Part | Edge rule |
| --- | --- |
| Source | A trigger on the request URL with a Lua pattern: `pattern:^https?://[^/]+` + the source + `/?$`. Escape `-`, `.`, `+`, `?`, `(`, `)`, `[`, `]`, `%`, `^` and `$` in the source with `%`. |
| `:param` in the source | `[^/]+` in the pattern. |
| `*` at the end of the source | `.*` in the pattern. |
| Target path | `https://%{Url.Hostname}` + the target. The API refuses a relative URL. |
| `:param` in the target | `%{Path.N}`, where `N` is the index of that segment in the source, counted from 0. |
| `:splat` in the target | `%{Path.N-}`, where `N` is the index of the `*` segment. |
| Target with a scheme (`https://...`) | Used as it is. |
| Status | `301` or `302`. bunny.net answers 301 for a rule set to 308 or 307, so map 308 to 301 and 307 to 302. |

Measured on bunny.net on 2026-11-15:

- A plain wildcard such as `*/old` also matched `/x/old`, and `*/old-blog/*` sent `/old-blog/a/b` to `/blog/a`. The anchored pattern matched `/exact` and `/exact/`, and not `/x/exact`, `/exactly` or `/seg/a/b`.
- Matching is case sensitive, as Astro's routes are.
- An edge rule redirect answers before the script runs, also on a path an on-demand route handles.
- A static target drops the query string, as Astro's own redirect does. A target ending in `%{Path.N}` kept it.
- A POST to a redirected path answers 301, so the browser repeats it as a GET. Astro itself answers 308 for a POST.

Limits:

- A pull zone has at most 50 edge rules by default, and a static site already uses 2. bunny.net support can raise the limit.
- A parameter has to be a whole path segment. A source like `/old-:id` cannot become `%{Path.N}`.

Mark the rules the tool creates, for example by a fixed prefix in the description, and replace only those on every deploy. Leave rules the site owner added alone.

A site's own `public/_redirects` lands in `dist/client/_redirects`. The tool can merge it with `dist/_redirects`, putting the site's own lines first, and should skip uploading it.

## Script variables

- **Secrets** from `astro:env` (`access: 'secret'`) and anything read through `process.env` at runtime are script variables.
- A script takes 128 variables (129 breaks startup), 2 KB per value at runtime, and the API refuses values over 4,096 characters. About 242 to 254 KB of values in total answered 431.
- Variables are not part of a release, so they do not roll back with the code.

## Optional

- **Custom error page:** the pull zone setting "Show custom error pages" takes one HTML page, at most 25,000 characters, for bunny.net's own error pages, with variables such as `{{status_code}}`. Whether it also replaces a 404 or 500 that the script answers is untested. A prerendered `500.html` could go there when it fits.
- **Hostname redirect:** an edge rule from the `b-cdn.net` hostname to the site's own domain.
