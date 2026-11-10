---
status: accepted; open (build.format file and preserve, files under dynamic routes, prerendered error pages)
date: 2026-10-28, rewritten 2026-11-10
---

# The pull zone serves stored files

## Context and problem statement

The script decides per request whether Astro renders or storage answers. `app.match()` returns a route for paths an on-demand route answers, and skips prerendered routes and paths Astro knows as public files. Astro writes a prerendered page as `about/index.html` by default (`build.format: 'directory'`), as `about.html` with `'file'`, and after its source file with `'preserve'`. Astro writes a redirect from its `redirects` config to a prerendered page as an HTML page with a meta refresh, and an i18n fallback to a prerendered page the same way.

Measured on bunny.net on 2026-11-09 and 2026-11-10, through a pull zone with the storage zone as origin:

- `/about` and `/about/` answered `about/index.html`. With `build.format: 'file'`, `/about` answered 404: the pull zone does not try `about.html`.
- A file an integration wrote after the build answered 200 from storage at `/late-root.txt`, but rendered the route at `/docs/late.txt`, where `docs/[...path].astro` is an on-demand catch-all.
- A public file under that catch-all, `/docs/guide.txt`, answered 200 from storage, since Astro knew it at build.
- A redirect from the config to an on-demand route answered a real 301; to a prerendered page, the meta refresh page with 200.
- A prerendered `404.astro` or `500.astro` answered an empty 404 or 500, since the script passes no `prerenderedErrorPageFetch`.

## Considered options

- **Map every path to a storage key in the script**, and ask storage first for paths a dynamic route claims. Handles every `build.format` and late files, but the script owns a second routing table.
- **Route first, and let the pull zone resolve the rest.**

## Decision outcome

Route first. A path `app.match()` returns a route for is rendered; every other path goes to the pull zone unchanged, and a 404 from storage is rendered by Astro.

- **Prerendered redirects and fallbacks are files.** A redirect to a prerendered page answers the meta refresh page Astro wrote, as a static deploy does. A real 301 needs an on-demand target, which Astro then answers itself.
- **No reserved paths.** Every file in the storage zone can be requested.

### Consequences

- Good: no routing table in the script, and the pull zone serves stored files from its cache and replicas.
- Bad: `build.format: 'file'` and `'preserve'` do not work.
- Bad: a file written after the build under a dynamic on-demand route is never served.
- Bad: a redirect to a prerendered page answers 200 with HTML, where every official adapter answers 301 or 308.
- Bad: prerendered error pages answer empty.

### Confirmation

The test app on bunny.net serves prerendered pages, public files, `/_astro/*` and late files at the root from storage, renders on-demand routes, and answers Astro's 404 page for a missing path.
