# Deploy specification

What a deploy tool has to do to publish a site built with this adapter. The adapter only builds; everything below happens outside the build.

## Build output

| Path | When | What it is |
| --- | --- | --- |
| `dist/client/` | always | Every file the site serves: prerendered pages, `public/` files and `/_astro/*` assets. |
| `dist/index.js` | only when the site has a server | The Edge Script, one plain ES module. A fully static site has none. |
| `dist/_redirects` | when the project has `redirects` | Astro's redirects in the `_redirects` format, outside `dist/client` so it is not uploaded. |
| `dist/server/` | sometimes | Astro's own server build. Not deployed. |

A custom `outDir` replaces `dist`.

## Resources

- **A storage zone** that holds `dist/client`.
- **A pull zone** with that storage zone as its origin.
- **A middleware Edge Script** attached to that pull zone, only for sites with `dist/index.js`. A script keeps the type it was created with, so it has to be created as a middleware script, not a standalone one.

## Release steps

1. **Build** with a fixed `ASTRO_KEY` in the environment. Astro encrypts server island props with a key made per build; without a fixed key, a page cached from one release breaks the islands of the next.
2. **Upload `dist/client`** to `deploys/<id>/` in the storage zone, keeping paths. `<id>` names the release.
3. **Publish `dist/index.js`** to the Edge Script, when it exists.
4. **Point the pull zone at the release** with the deploy folder rules (see below).
5. **Apply the redirects** as edge rules (see below).
6. **Purge the pull zone.** A full zone purge took effect within 30 seconds. A tag purge against a script response had not taken effect after 5 minutes.

Uploading before publishing means new hashed assets exist before a new script or page asks for them. A rollback publishes the earlier script and points the rule back at its folder, then purges; no file moves.

A deploy to the root of the storage zone, without the folder rules, also works. Then every stored file is publicly readable, and the tool has to remove files the build no longer has: the script asks storage first for every GET and HEAD, so a file left over from an earlier build wins over an on-demand route on the same path.

## Deploy folders

Two edge rules serve one release and hide the others, the same way `bunny sites` does:

| Rule | Trigger | Action |
| --- | --- | --- |
| Gate | URL `*/deploys/*` | Block request (`ActionType` 4) |
| Origin | URL matches none of `*/deploys/*` | Origin storage (`ActionType` 17): `ActionParameter1` the storage zone id, `ActionParameter2` its name, `ActionParameter3` `/deploys/<id>`. Extra action: set request header (`ActionType` 6) `X-Bunny-Deploy` to `<id>`. |

The rule puts the folder in front of the path before the script runs, so the script sees `/deploys/<id>/about`. When `X-Bunny-Deploy` is set and the path starts with its folder, the script strips the folder for routing, `Astro.url` and the cache rule, and adds it back for storage. Without the header the script uses the path as it is.

Measured on bunny.net on 2026-11-15, on a pull zone with the middleware script:

- A file came from the release folder, not from the root, and `/deploys/<id>/...` answered 403.
- The test app passed its 56 checks under the rules, and a `build.format: 'file'` build its 32.
- `ActionParameter3` with a trailing slash, `/deploys/<id>/`, made the script see `/deploys/<id>//about`.

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

## Trailing slash

With `trailingSlash` set to `'always'` or `'never'`, the script redirects a path in the wrong form with 301 (308 for other methods), as Astro does for the pages it renders. It skips `/`, internal paths such as `/_astro/...`, files with an extension for `'always'`, and the files of the build.

A static site has no script. Edge rules can do part of it, measured on 2026-11-15:

- `'always'`: a URL trigger `pattern:^https?://[^/]+/.*[^/]$` together with a second trigger in "match none" mode for `pattern:^https?://.*/[^/]+%.%w+$` and the build's files without an extension, redirecting to `https://%{Url.Hostname}%{Url.Directory}%{Url.FileName}/`. It drops the query string; every path variable (`%{Path.0-}`, `%{Url.Path}`, `%{Request.Path}`) includes it.
- `'never'`: `pattern:^https?://[^/]+/.+/$` redirecting to `https://%{Url.Hostname}/%{Path.0-}` worked without a query string, but with one it redirected to the same URL, a loop. Do not use it until a rule can tell requests with a query apart.
- A duplicate trailing slash, `pattern:^https?://[^/]+/.-//+$`, collapsed to one.

## Redirects

The adapter sets `build.redirects: false`, so Astro writes no meta refresh pages, and writes Astro's `redirects` to `dist/_redirects`. On a site with a script, the script answers these redirects itself with a real 301 or 308, so edge rules are optional there: they answer before the script runs. A static site has no script, so without edge rules its redirects answer 404. Each line has a source, a target and a status:

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

- A pull zone has at most 50 edge rules by default. The deploy folder rules take 2, and a static site's cache rules 2 more. bunny.net support can raise the limit.
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
