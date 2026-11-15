---
status: accepted; open (prerendered error pages)
date: 2026-10-28, rewritten 2026-11-15
---

# The pull zone serves stored files

## Context and problem statement

The script decides per request whether Astro renders or storage answers. `app.match()` returns a route for paths an on-demand route answers, and skips prerendered routes and paths Astro knows as public files; `app.match(request, true)` also returns prerendered routes, with `prerender`, `type` and `isIndex`. Astro writes a prerendered page as `about/index.html` by default (`build.format: 'directory'`), as `about.html` with `'file'`, and with `'preserve'` as `about.html` for `about.astro` but `posts/index.html` for `posts/index.astro`. Pages, redirects and i18n fallbacks get these names; a prerendered endpoint keeps its path as is. Astro writes a redirect from its `redirects` config to a prerendered page as an HTML page with a meta refresh, and an i18n fallback to a prerendered page the same way.

Measured on bunny.net between 2026-11-09 and 2026-11-13, through a pull zone with the storage zone as origin:

- `/about` and `/about/` answered `about/index.html`, and `/` answered `index.html`. With `build.format: 'file'`, `/about` answered 404: the pull zone does not try `about.html`.
- When the request hook returned the request with `/about.html` as its path, the pull zone fetched that path and the visitor got the page under `/about`. The response hook then received that rewritten request.
- With the route checked first, a file an integration wrote after the build answered 200 at `/late-root.txt`, but `/docs/late.txt` rendered `docs/[...path].astro`, an on-demand catch-all. With storage asked first, `/docs/late.txt` answered the file.
- With storage asked first for every GET and HEAD, a `'file'` and a `'preserve'` build each passed 32 checks: pages with and without a trailing slash, a dynamic prerendered route, an index route, a page named `v1.2`, a prerendered endpoint without extension, redirects, an i18n fallback, `/CNAME`, late files, and the 404 page for a missing path and for a path the dynamic route did not generate. A `'directory'` build passed the 50 checks of the test app.
- A rendered response with `s-maxage=60` was a cache HIT on the second request, with the route checked first and with storage asked first.
- A redirect from the config to an on-demand route answered a real 301; to a prerendered page, the meta refresh page with 200, until `build.redirects: false` let the script answer it.
- Behind an edge rule that serves `deploys/<id>` in storage, the script saw `/deploys/<id>/about`, and on-demand routes answered 404 until the script stripped the folder (2026-11-15).
- A prerendered `404.astro` or `500.astro` answered an empty 404 or 500, since the script passes no `prerenderedErrorPageFetch`.

## Considered options

- **Route first, and let the pull zone resolve the rest.** No extra request for on-demand pages, but `'file'` and `'preserve'` answer 404 and a late file under a dynamic route is never served.
- **Map every path to a storage key with a file list from the build.** Handles every format, but the script owns a second routing table and misses files added after the build.
- **Storage first for GET and HEAD, with prerendered routes rewritten to their file.**

## Decision outcome

Storage first. Every GET and HEAD goes to the pull zone, and a 404 from storage is rendered by Astro: the on-demand route if one matches, otherwise its 404 page.

- **Prerendered routes are rewritten to their file.** When `app.match(request, true)` returns a prerendered route that is not an endpoint, and the build format is `'file'`, or `'preserve'` for a route that is not an index route, the path without its trailing slash gets `.html`. `/` and every other path pass unchanged, so the pull zone resolves `index.html` and stored files itself.
- **Redirects are rendered, fallbacks are files.** A redirect route answers 301 or 308 from the script. An i18n fallback to a prerendered page answers the meta refresh page Astro wrote.
- **A deploy folder is optional.** When an edge rule serves `deploys/<id>` and names it in `X-Bunny-Deploy`, the script strips that folder before routing and adds it back for storage. Without it, files come from the root.

### Consequences

- Good: `'file'` and `'preserve'` work, with one storage request per page and no file list.
- Good: a stored file wins over an on-demand route on the same path, as in the Node adapter.
- Bad: every on-demand GET waits for a 404 from storage before it renders. The added time is not measured.
- Bad: without a deploy folder, a file left in storage by an earlier build wins over an on-demand route that replaced it, so a deploy to the root has to remove files the build no longer has.
- Bad: when a rewritten path has no file, the 404 page renders with the rewritten request, so its `Astro.url` ends in `.html`.
- Bad: an i18n fallback to a prerendered page answers 200 with HTML.
- Bad: prerendered error pages answer empty.

### Confirmation

The test app on bunny.net serves prerendered pages, public files, `/_astro/*` and late files from storage with `build.format` `'directory'`, `'file'` and `'preserve'`, serves a late file under an on-demand catch-all, renders on-demand routes, and answers Astro's 404 page for a missing path, from the root and from a deploy folder.
