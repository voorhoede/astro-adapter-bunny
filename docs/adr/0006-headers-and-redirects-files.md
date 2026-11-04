---
status: accepted
date: 2026-10-28, updated 2026-11-04
---

# `_headers` and `_redirects` for stored files, with Cloudflare's semantics

## Context and problem statement

Stored files never pass Astro middleware, so a security header baseline on them needs the adapter. bunny.net's documentation does not mention `_headers` or `_redirects` (searched on 2026-10-28), so they are not a platform feature; the bunny-edge-deploy GitHub Action turns them into pull zone edge rules for static builds. A static build has no script, so an adapter option cannot reach it at all.

## Considered options

- **A `headers` option, applied by the script.** Static builds get nothing; one more option.
- **A `headers` option plus `public/_headers`.** Two inputs for the same thing, merged with a precedence rule.
- **Only `public/_headers` and `public/_redirects`, with Cloudflare's semantics.** One input, portable, and the same file for script and static builds.

## Decision outcome

The third. There is no `headers` option.

- **Semantics.** Cloudflare's documented `_headers` and `_redirects` semantics, applied only to stored files: path matching with splats and placeholders, several matching `_headers` blocks combining, `! Name` detaching a header, redirect statuses, and status 200 serving another stored file. A syntax error in either file fails the build with the line number.
- **Precedence.** What Astro sets per page (`staticHeaders`, `routeToHeaders`) beats `_headers`, which fills only missing headers. `_headers` may set `Cache-Control` on stored files, as on Cloudflare and Netlify; it beats the adapter's defaults, and only a 5xx stays `private, no-store`. Rendered responses own their headers, set in Astro middleware.
- **Redirects.** `_redirects` covers paths no on-demand route claims. A redirect from a path a dynamic route answers belongs in Astro's own `redirects` config. A `_redirects` rule keeps the visitor's query, as Netlify does, unless the target has its own.
- **Script builds.** The build parses both files into data in the script, the script applies them to stored files, and `/_headers` and `/_redirects` answer 404.
- **Static builds.** The files stay in `dist/client`, and the deploy tool turns them into edge rules. A pull zone takes 50 edge rules, so the build warns above 50 and the deploy fails with a clear message.
- **Our own parsers.** No third-party parser follows Cloudflare's semantics (checked `@astrojs/underscore-redirects`, `@cloudflare/pages-shared`, `@cloudflare/workers-shared`, `netlify-redirect-parser` and `netlify-headers-parser` on 2026-10-28).
- **A baseline set in code** moves to a `/*` block in `_headers`. A Content Security Policy set that way loses on prerendered pages to Astro's own per-page CSP, so directives such as `frame-ancestors` belong in Astro's CSP config.

### Consequences

- Good: one input for script and static builds, and the file works on other hosts too.
- Good: no parsing at runtime.
- Bad: a site cannot feed the adapter its headers from a TypeScript module without writing the file.
- Bad: a static build gets only what the deploy tool can express as edge rules, so script and static builds can differ. On 2026-10-28 the Action's parser dropped `! Name` without a warning, kept `:splat` and `:placeholder` literally in targets and patterns, and read a query condition as literal path text.
- Bad: the header table grows with every distinct per-page CSP, since `routeToHeaders` holds one entry per prerendered pathname.

### Confirmation

Rule matching and precedence are tested as tables against Cloudflare's documentation. A build of the test app checks the parsed table and the warning above 50 rules, and a static build keeps both files unchanged. Over HTTP, `_headers` lands on stored files and not on rendered ones, a `_redirects` rule keeps the query, and `/_headers` and `/_redirects` answer 404.
