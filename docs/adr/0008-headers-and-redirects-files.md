---
status: accepted (Cloudflare semantics, stored files only, no `headers` option, precedence, `_redirects` only for paths no on-demand route claims, static builds through the deploy tool, the visitor's query on redirects, Astro config redirects in static builds, our own parsers); proposed (the rest)
date: 2026-10-28
---

# `_headers` and `_redirects` for stored files, with Cloudflare's semantics

## Context and problem statement

Stored files never pass Astro middleware, so a security header baseline on them needs the adapter. bunny.net's documentation never mentions `_headers` or `_redirects` (searched on 2026-10-28), so they are not a platform feature; the bunny-edge-deploy GitHub Action already turns them into edge rules for static builds. A static build has no script, so an adapter option cannot reach it at all.

## Considered options

- **A `headers` option, applied by the script.** Static builds get nothing; one more option.
- **A `headers` option plus `public/_headers`.** Two inputs for the same thing, merged with a precedence rule.
- **Only `public/_headers` and `public/_redirects`, with Cloudflare's semantics.** One input, portable, and the same file for script and static builds.

## Decision outcome (accepted)

The third. There is no `headers` option.

- **Semantics.** Cloudflare's documented `_headers` and `_redirects` semantics, applied only to stored files. Rendered responses own their headers, set in Astro middleware.
- **Redirects.** `_redirects` covers paths no on-demand route claims. A redirect from a path a dynamic route answers belongs in Astro's own `redirects` config.
- **Precedence.** What Astro sets per page (`staticHeaders`, `routeToHeaders`) beats `_headers`, which fills only missing headers. `_headers` may set `Cache-Control` on stored files, as `_headers` and `netlify.toml` may on Cloudflare and Netlify; it beats the adapter's defaults, and a 5xx stays `private, no-store`. Later, not in version 1: writing `routeRules` headers into `_headers` for static builds, which no official adapter does.
- **Script builds.** The build parses both files into data in the script; the script applies them to stored files and answers 404 for `/_headers` and `/_redirects`.
- **Static builds.** The files stay in `dist/client` and the deploy tool turns them into edge rules. A pull zone takes 50 edge rules; the adapter warns at build above 50, and the deploy fails with a clear message.
- **Query on redirects.** The visitor's query is kept, as Netlify does, unless the target has its own query. This applies to `_redirects` rules and to Astro config redirects; Astro itself drops the query on config redirects (verified in an Astro 7.4.2 build).
- **Astro config redirects in static builds.** Without a script nothing answers them, so the adapter appends them to `dist/client/_redirects` after the project's rules.
- **Our own parsers.** No third-party parser follows Cloudflare's semantics (checked `@astrojs/underscore-redirects`, `@cloudflare/pages-shared`, `@cloudflare/workers-shared`, `netlify-redirect-parser` and `netlify-headers-parser` on 2026-10-28), so the build has its own.
- **Moving a `headers` option to `_headers`.** A site that set its baseline in code moves it to a `/*` block. A Content Security Policy set that way loses on prerendered pages to Astro's own per-page CSP, so directives such as `frame-ancestors` belong in Astro's CSP config.

Proposed details, each pinned by a unit test against Cloudflare's documentation: path matching (splats, placeholders), several matching `_headers` blocks combining, `! Name` detaching a header, redirect statuses, status 200 serving another stored file, and the query cases above. A syntax error in either file fails the build with the line number.

### Consequences

- Good: one input for script and static builds, and the file works on other hosts too.
- Good: no runtime parser.
- Bad: a site can no longer feed the adapter its headers from a TypeScript module without writing the file.
- Bad: a static build gets only what the deploy tool can express as edge rules, so script and static builds can differ. On 2026-10-28 the Action's parser dropped `! Name` without a warning, kept `:splat` and `:placeholder` literally in targets and patterns, and read a query condition as literal path text.
- Bad: the header table grows with every distinct per-page CSP. `routeToHeaders` holds one entry per prerendered pathname, `/404` included.

### Confirmation

Rule matching and precedence are tested as tables. A build of the test app with both files checks the parsed table, the warning above 50 rules, and that a static build copies the files unchanged. Over HTTP, `_headers` lands on stored files and not on rendered ones, `/` keeps exactly one CSP, and `/_headers` and `/_redirects` answer 404.
