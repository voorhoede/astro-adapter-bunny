---
status: accepted
date: 2026-10-28, rewritten 2026-11-10
---

# No `_headers` or `_redirects` files

## Context and problem statement

Cloudflare and Netlify read `public/_headers` and `public/_redirects` to add headers to stored files and redirect paths without code. bunny.net's documentation does not mention either file (searched on 2026-10-28), so a pull zone serves them as ordinary files. A pull zone takes 50 edge rules. No third-party parser follows Cloudflare's semantics (checked `@astrojs/underscore-redirects`, `@cloudflare/pages-shared`, `@cloudflare/workers-shared`, `netlify-redirect-parser` and `netlify-headers-parser` on 2026-10-28).

Stored files pass through the script's response hook, so headers on them are in reach of the adapter. Redirects in Astro's own `redirects` config already work: to an on-demand route as a real redirect, to a prerendered page as a meta refresh page.

## Considered options

- **Parse both files at build and apply them in the script**, with Cloudflare's semantics. Portable, but a parser and a matcher of our own.
- **A `headers` option for stored files.** One more option.
- **Neither, for now.**

## Decision outcome

Neither. The adapter does not read `_headers` or `_redirects`. A redirect goes in Astro's `redirects` config, and a header on rendered pages in Astro middleware.

### Consequences

- Good: no parser, no matcher, no option.
- Bad: stored files get only the adapter's `Cache-Control`, no security header baseline.
- Bad: a site moving from Cloudflare or Netlify loses its `_headers` and `_redirects` rules, and the files become publicly readable.

### Confirmation

`/_headers` and `/_redirects` in `public/` answer as stored files, and a path in `_redirects` is not redirected.
