---
status: proposed
date: 2026-10-28
---

# Static first: storage answers before a dynamic route does

## Context and problem statement

A file in the client output must win over a dynamic on-demand route, including files integrations write after the adapter (R-ROUTE-2). Astro's `app.match()` skips paths listed in `manifest.assets`, a glob of the client directory taken when the server manifest is built. `@astrojs/sitemap` and the reference site's service worker write files later, so `[locale]/index.astro` claims `/sitemap-index.xml` and rewrites to 404. The reference site works around it with `assetManifest: false` today.

## Considered options

- **Trust `manifest.assets`.** Misses late files; the bug stays.
- **A file list written at the end of the build.** Depends on integration order in `astro:build:done`, which the adapter does not control (requirements open question 3).
- **A file table written by the deploy tool.** Exact, but moves routing data into a tool the adapter does not own.
- **Ask storage first** for any path a dynamic on-demand route would claim; render only on a storage 404.

## Decision outcome

Ask storage first. For a GET or HEAD whose path matches an on-demand route with params, or matches nothing on demand, the decision is `file` with `otherwise` set to render or not found. A path matching an on-demand route with a fixed pathname renders directly; Astro already warns at build when a public file collides with such a route. Non-GET requests never go to storage, so bodies are not forwarded there. One key per request: no chain of candidate keys.

Reserved paths never reach storage for a visitor, in both script types: `/_bunny/` (server parts, ADR 0007), `/_headers` and `/_redirects` (ADR 0008), and `/deploys/...` through the re-prefixed rewrite (R-TYPE-2).

### Consequences

- Good: the bug is fixed without a file list, and without caring about integration order.
- Good: `assetManifest` disappears as an option.
- Good: the astro research question whether `public/` files are in `manifest.assets` no longer matters.
- Bad: every on-demand request under a catch-all pays one storage miss before rendering. In middleware that is a replica round trip, in standalone a main-region one. The cost of a replica 404 is expected small but not measured (spike S1).
- Bad: an extensionless public file (`/CNAME`) maps to `CNAME/index.html` and is not found. Documented as a limit.

### Confirmation

A test app with a `[locale]` catch-all and `@astrojs/sitemap` serves `sitemap-index.xml` with 200 in both script types (M4, M5). The harness logs every storage file read and fails a request that makes more than one (server part reads are counted separately). Each reserved path answers 404. S1 measures the storage miss.
