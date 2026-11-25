# Deploy specification

What a deploy tool has to do to publish a site built with this adapter. The adapter only builds; everything below happens outside the build.

## Build output

| Path | When | What it is |
| --- | --- | --- |
| `dist/client/` | always | Every file the site serves: prerendered pages, `public/` files and `/_astro/*` assets. |
| `dist/index.js` | only when the site has a server | The Edge Script, one plain ES module. A fully static site has none. |
| `dist/client/_redirects` | when the project has `redirects` or `public/_redirects` | The site's own lines first, then Astro's redirects in the `_redirects` format. |
| `dist/client/_headers` | when a prerendered page has a Content-Security-Policy or the site has `public/_headers` | The site's own lines first, then each prerendered page's Content-Security-Policy in the `_headers` format. |
| `dist/server/` | sometimes | Astro's own server build. Not deployed. |
| `.bunny/build.json` | always | The build manifest (see below), at the project root. A build output, so keep it out of version control. |

A custom `outDir` replaces `dist`.

## Build manifest

`.bunny/build.json` uses the shape bunny.net's own adapters write and its CLI reads, so a deploy tool needs to know nothing about Astro:

| Field | Meaning |
| --- | --- |
| `manifestVersion` | `1`. |
| `adapter`, `framework` | Package names and versions. |
| `kind` | `ssr` when there is a script, `static` when the build is files only. |
| `script` | Only for `ssr`: `entry` (`dist/index.js`), `type` (`middleware`) and `bytes`. |
| `assets.dir` | The folder to upload, `dist/client`. |
| `requires.pullZone` | Only for `ssr`: `disableCookies: false` and `enableSmartCache: false`. |
| `requires.env` | Only for `ssr`: every `astro:env` secret, with `secret: true`, and `optional: true` when it is optional or has a default. |
| `dev.command` | Only for `ssr`: `astro dev`. |
| `astroAdapterBunny` | Our own fields, under one key: `trailingSlash`, `base`, `buildFormat`, `assetsDir`, `redirects` (the path of `dist/client/_redirects`, when it exists), `headers` (the path of `dist/client/_headers`, when it exists). |

Paths are relative to the project root and use forward slashes. bunny.net's contract says its CLI ignores fields it does not know; whether its CLI accepts this manifest is untested.

## Resources

A release is one build of one commit, and is not changed once deployed:

- **A storage zone** that holds the release's `dist/client` at its root, named after the site and the commit's short hash.
- **A middleware Edge Script** with the release's `dist/index.js` and its variables and secrets, named like the zone, only for sites with `dist/index.js`. A script keeps the type it was created with, so it has to be created as a middleware script, not a standalone one.

A pull zone points at one release, by its storage zone and its script:

- **A pull zone per branch** that deploys, which serves as that branch's preview.
- **A live pull zone** that holds the site's custom hostnames, added once by hand.

Several pull zones can point at the same release. Measured on bunny.net on 2026-11-23: one middleware script served two pull zones at once, each from its own storage zone, and the script's `LinkedPullZones` listed both.

## Release steps

1. **Build** with a fixed `ASTRO_KEY` in the environment. Astro encrypts server island props with a key made per build; without a fixed key, a page cached from one release breaks the islands of the next.
2. **Create the release's storage zone** with the site's region, tier and replication regions, and set its 404 page (see Static sites). A new zone can refuse uploads for a few seconds, so retry the first one.
3. **Upload `dist/client`** to the root of the zone, keeping paths, and under the site's `base` when it has one (see below).
4. **Create the release's script**, when `dist/index.js` exists: set its code, variables and secrets, and publish it.
5. **Switch the branch's pull zone** to the release (see below), and check it.
6. **Switch the live pull zone** to the same release, for the production branch, and check it again.

A rollback switches a pull zone to an earlier release that still exists. No file is uploaded and no hostname moves.

A release's zone starts empty, so no file of an earlier build is left behind. That matters for a site with a script: the script asks storage first for every GET and HEAD, so a leftover file would win over an on-demand route on the same path.

Measured on bunny.net on 2026-11-20: a new storage zone on the Edge tier in DE accepted its first upload after 1.3 to 4.8 s, and 30 files (116 KB) took 10 to 15 s to upload, eight at a time. On 2026-11-23, after a storage zone was deleted, creating one with the same name was refused with `storagezone.name_taken` ("currently being deleted") for the 10 minutes tried. So redeploying a commit whose release was just deleted fails for a while.

## Switching a pull zone

Switching a pull zone to a release is one `POST /pullzone/{id}` that sets `OriginType: 2`, `StorageZoneId` and `MiddlewareScriptId` together, then a purge of that pull zone, then the redirect and header rules of the release (see below). The tool then checks the pull zone until it answers with the new release.

Measured on bunny.net on 2026-11-23, with every request reaching edge servers in DE:

- Without `OriginType: 2` in the body, the call answered 204 and kept the old storage zone, while the script changed.
- Without a purge, the edge did not follow the change predictably. Once the script changed after 33 s while the storage zone was still the old one after 12 minutes. Once neither changed in 120 s. Requests had unique query strings, so no cached file was involved.
- With all three fields in one call and a purge after it, seven switches never answered a script with another release's storage zone, polled from six threads every 100 ms (about 4,500 requests). The new pair answered 2 to 7 s after the call, and old and new pairs overlapped across edge servers for at most 0.5 s.

Untested: switching from other regions, and switching a pull zone without a script, as a static site has.

The redirect and header rules belong to the pull zone, not to the release, so they change in a separate step after the switch. Until they do, a prerendered page of the new release can get the Content-Security-Policy of the old one. How long that lasts is untested.

## Pull zone settings

Required for every site with a script:

| Setting | Value | Why |
| --- | --- | --- |
| Smart Cache | off | It replaces every `Cache-Control` on HTML and JSON with `no-cache`. |
| Cache expiration | respect the origin (`CacheControlMaxAgeOverride: -1`) | Otherwise a fixed time overrides every header the script sets, and a rendered page that sets cookies or differs per visitor is served to everyone. A zone created through the API had 30 days. |
| Query strings | not ignored | Otherwise every query gets the first cached response. |
| Disable cookies | off | It strips every `Set-Cookie`. |
| Cache slicing ("Optimize for video") | off (`EnableCacheSlice: false`) | On by default for a storage origin. With it on, a page on a path without an extension (`/about/`, `/about`), a `.txt` and a `.png` got no `ETag`, so they could never answer 304. With it off, every URL had one (2026-11-24). |

Leave "cache error responses" off, unless the site wants errors cached.

Force SSL on the `b-cdn.net` hostname, as `bunny sites` does.

## Static sites

A site without `dist/index.js` has no script to set headers or answer 404s, so the zones take over. `bunny sites` caches everything at the edge for 30 days and purges on every release, and lets browsers revalidate:

- **Pull zone:** `CacheControlMaxAgeOverride: 2592000` and `CacheControlPublicMaxAgeOverride: 0`. Taken from `bunny sites`; untested on our zones.
- **Edge rule:** URL `*/_astro/*` sets the response header `Cache-Control: public, max-age=31536000, immutable`. When `build.assets` is not `_astro`, use that folder name. `bunny sites` instead gives browsers one day per extension (`css`, `js`, `svg`, `png`, `woff2` and more); a hashed folder can be cached for longer.
- **Storage zone 404:** `Custom404FilePath` set to `/404.html` on the release's storage zone when the build has a `404.html`, else empty; `Rewrite404To200` off. A site with a script needs it too when `404.astro` is prerendered: the script passes this page on for a path no route answers. The setting belongs to the storage zone, so it switches with the release.

Without settings, storage answered every file with `max-age=25600000`, and a missing path with bunny.net's own 404 page. Measured earlier: the `*/_astro/*` rule above, a second rule setting `public, max-age=0, must-revalidate` on every other URL, and `Custom404FilePath: /404.html` made a static site answer as a site with a script does.

A site with a script must not get the cache override or these rules: the script sets `Cache-Control` itself.

## Base

With `base: '/docs'`, Astro writes `dist/client` without the `docs` folder, but every URL the site links to starts with `/docs/`. Upload `dist/client` to `docs/` in the release's storage zone, so stored paths match the URLs; the script then strips nothing for storage, and a static site needs no rule for it. The manifest names the base in `astroAdapterBunny.base`.

- `Custom404FilePath` becomes `/docs/404.html`.
- A static site's asset rule matches `*/docs/_astro/*`.
- A path outside the base finds nothing in storage and answers the 404 page.
- `dist/client/_redirects` puts the base in front of each source. Astro answers a redirect with the target as written, without the base, and so does an edge rule made from the file.

Measured on bunny.net on 2026-11-15: a build with `base: '/docs'` uploaded under `docs/` passed 14 checks.

## Trailing slash

With `trailingSlash` set to `'always'` or `'never'`, the script redirects a path in the wrong form with 301 (308 for other methods), as Astro does for the pages it renders. It skips `/`, internal paths such as `/_astro/...`, files with an extension for `'always'`, and the files of the build.

A static site has no script. Edge rules can do part of it, measured on 2026-11-15:

- `'always'`: a URL trigger `pattern:^https?://[^/]+/.*[^/]$` together with a second trigger in "match none" mode for `pattern:^https?://.*/[^/]+%.%w+$` and the build's files without an extension, redirecting to `https://%{Url.Hostname}%{Url.Directory}%{Url.FileName}/`. It drops the query string; every path variable (`%{Path.0-}`, `%{Url.Path}`, `%{Request.Path}`) includes it.
- `'never'`: `pattern:^https?://[^/]+/.+/$` redirecting to `https://%{Url.Hostname}/%{Path.0-}` worked without a query string, but with one it redirected to the same URL, a loop. Do not use it until a rule can tell requests with a query apart.
- A duplicate trailing slash, `pattern:^https?://[^/]+/.-//+$`, collapsed to one.

## Redirects

The adapter sets `build.redirects: false`, so Astro writes no meta refresh pages, and writes Astro's `redirects` to `dist/client/_redirects`. On a site with a script, the script answers these redirects itself with a real 301 or 308, so edge rules are optional there: they answer before the script runs. A static site has no script, so without edge rules its redirects answer 404. Each line has a source, a target and a status, as Astro's own redirect answers a GET: a configured status only when the target is a route, and 301 otherwise:

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

- A pull zone has at most 50 edge rules by default. A static site's asset rule takes 1. bunny.net support can raise the limit.
- A parameter has to be a whole path segment. A source like `/old-:id` cannot become `%{Path.N}`.

Mark the rules the tool creates, for example by a fixed prefix in the description, and replace only those on every deploy. Leave rules the site owner added alone.

The adapter appends Astro's redirects to a site's own `public/_redirects`, so the site's lines come first. The file is uploaded with `dist/client` and is publicly readable unless the tool skips it.

## Headers

With `security.csp`, the adapter writes no `<meta>` policy into prerendered pages. It appends each page's Content-Security-Policy to `dist/client/_headers`, after the lines of a site's own `public/_headers`. Each block is a path and its indented headers:

```
/about
  Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-...'
```

Only the policy is listed: other headers Astro saw while prerendering, such as an i18n fallback's `Location`, are not. On-demand pages send their own policy.

Translate the file into edge rules with the action "Set response header", one group per header name:

- **The most common value** goes in one rule with two triggers, both required: the response header is missing (trigger "Response header", match none of `*`), and the URL matches none of the paths that have another value.
- **Every other value** gets its own rule: the response header is missing, and the URL matches one of its paths. Use the same anchored pattern as for redirects.

A trigger takes 5 patterns, so split a longer exception list over more triggers. The "response header is missing" trigger keeps a header a route sets itself.

Measured on bunny.net on 2026-11-17 with `security.csp`: the edge rules made from the file set each prerendered page's own policy, two pages with different policies each got theirs, an on-demand page kept its own, and no prerendered page carried a `<meta>` policy.

Limits: every distinct value takes one edge rule, from the same 50 as the redirects.

## Script variables

- **Secrets** from `astro:env` (`access: 'secret'`) and anything read through `process.env` at runtime are script variables.
- A script takes 128 variables (129 breaks startup), 2 KB per value at runtime, and the API refuses values over 4,096 characters. About 242 to 254 KB of values in total answered 431.
- Variables belong to a script, and every release has its own script, so the tool sets them all on every deploy. A rollback brings back the values the earlier release had, including ones revoked since.

## Optional

- **Custom error page:** the pull zone setting "Show custom error pages" takes one HTML page, at most 25,000 characters, for bunny.net's own error pages, with variables such as `{{status_code}}`. Whether it also replaces a 404 or 500 that the script answers is untested. A prerendered `500.html` could go there when it fits.
- **Hostname redirect:** an edge rule from the `b-cdn.net` hostname to the site's own domain.
