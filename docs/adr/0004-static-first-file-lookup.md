---
status: accepted
date: 2026-10-28, updated 2026-11-04
---

# Static first: storage answers before a dynamic route does

## Context and problem statement

A file in the client output must win over a dynamic on-demand route, including files integrations write after the adapter. Astro's `app.match()` skips paths listed in `manifest.assets`, a glob of the client directory taken when the server manifest is built. `@astrojs/sitemap` and service worker integrations write files later, so a `[locale]/index.astro` route claims `/sitemap-index.xml` and renders a 404 for it. Sites work around it with `assetManifest: false`.

## Considered options

- **Trust `manifest.assets`.** Misses late files; the bug stays.
- **A file list written at the end of the build.** Depends on the order of integrations in `astro:build:done`, which the adapter does not control.
- **A file table written by the deploy tool.** Exact, but moves routing data into a tool the adapter does not own.
- **Ask storage first** for any path a dynamic on-demand route would claim, and render only on a storage 404.

## Decision outcome

Ask storage first. For a GET or HEAD whose path matches an on-demand route with params, or matches nothing on demand, the decision is a stored file with render or not found as the fallback. A path matching an on-demand route with a fixed pathname renders directly; Astro already warns at build when a public file collides with such a route. Other methods never go to storage, so request bodies are not forwarded there. One storage key per request, never a chain of candidates.

- **Key mapping.** A last path segment with a dot is a literal file; otherwise `p/index.html` (`build.format: 'directory'`) or `p.html` (`'file'`). A prerendered page is looked up by the file Astro wrote for it, so with `'preserve'` `/blog/a` reads `blog/a.html` or `blog/a/index.html` depending on its source file. Prerendered redirect routes still render.
- **Reserved paths** never reach storage for a visitor and answer 404 in both script types: `/_bunny/` (the adapter's namespace), `/_headers`, `/_redirects`, and `/deploys/...` through the re-prefixed rewrite. They are compared case-insensitively and after decoding, since storage reads through the CDN ignore case.

### Consequences

- Good: late files win without a file list, whatever the integration order.
- Good: `assetManifest` disappears as an option.
- Bad: every on-demand request under a catch-all pays one storage miss before rendering: a replica round trip in middleware, a main-region one in standalone. Not measured.
- Bad: an extensionless public file such as `/CNAME` maps to `CNAME/index.html` and is not found.

### Confirmation

A fixture with a `[locale]` catch-all serves a late-written file with 200 and renders the route when storage has no file, in both script types. The test harness counts storage reads per request. Each reserved path answers 404.
