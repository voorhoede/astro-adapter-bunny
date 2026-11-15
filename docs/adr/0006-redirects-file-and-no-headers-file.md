---
status: accepted
date: 2026-10-28, rewritten 2026-11-15
---

# A redirects file for edge rules, and no `_headers`

## Context and problem statement

Cloudflare and Netlify read `public/_headers` and `public/_redirects` to add headers to stored files and redirect paths without code. bunny.net's documentation does not mention either file (searched on 2026-10-28), so a pull zone serves them as ordinary files. No third-party parser follows Cloudflare's semantics (checked `@astrojs/underscore-redirects`, `@cloudflare/pages-shared`, `@cloudflare/workers-shared`, `netlify-redirect-parser` and `netlify-headers-parser` on 2026-10-28).

By default Astro writes a redirect from its `redirects` config to a prerendered page as an HTML page with a meta refresh, which answers 200. The official Node, Vercel and Cloudflare adapters set `build.redirects: false` and answer a real 301 or 308: Node from its server, Netlify and Cloudflare through a `_redirects` file for their platform, Vercel through its route config. `build.redirects: false` only drops redirect routes; i18n fallbacks still get their meta refresh page. `@astrojs/underscore-redirects`, which Netlify and Cloudflare use, writes a dynamic redirect as a rewrite to the target's HTML file or to a function, not as a redirect between two patterns.

bunny.net has edge rules with a "Redirect to URL" action. Measured on 2026-11-15 on a pull zone with a middleware script:

- The target has to be an absolute URL; `https://%{Url.Hostname}/about` was accepted, `/about` was refused.
- `%{Path.1}` and `%{Path.1-}` filled in path segments: `/seg/a` went to `/blog/a`, `/moved/x/y/z.txt` to `/docs/x/y/z.txt`.
- A plain wildcard `*/old` also matched `/x/old`. An anchored Lua pattern, `pattern:^https?://[^/]+/exact/?$`, matched `/exact` and `/exact/` only.
- Rules set to 307 or 308 answered 301; 302 answered 302.
- A rule answered before the script, also on a path an on-demand route handles.
- A pull zone takes 50 edge rules, 5 triggers per rule and 5 conditions per trigger, by default.

## Considered options

- **Parse `_headers` and `_redirects` at build and apply them in the script**, with Cloudflare's semantics. Portable, but a parser and a matcher of our own.
- **Keep Astro's meta refresh pages.** Nothing for a deploy tool to do, but every redirect to a prerendered page answers 200.
- **Real redirects from the script, and Astro's redirects written to a file a deploy tool turns into edge rules.**

## Decision outcome

The third, for redirects. The adapter sets `build.redirects: false` and writes Astro's `redirects` to `dist/_redirects`, outside `dist/client`, one line per redirect: source, target and status, with `:param` for a dynamic segment and `*` and `:splat` for a rest segment. The script renders a redirect route itself, so a site with a script answers a real 301 or 308 without any edge rule. A deploy tool turns the file into edge rules, which a static site needs and a site with a script may use to answer before the script.

The adapter does not read `_headers` or a site's own `public/_redirects`. A header on rendered pages goes in Astro middleware.

### Consequences

- Good: redirects answer 301 or 308, as with the official adapters, and dynamic redirects work.
- Good: a deploy tool gets the redirects in the format Netlify and Cloudflare use.
- Bad: a static site depends on its deploy tool for redirects; without edge rules they answer 404.
- Bad: an edge rule answers 301 where Astro answers 308 for a POST, and holds a parameter only as a whole path segment.
- Bad: stored files get only the adapter's `Cache-Control`, no security header baseline.
- Bad: a site moving from Cloudflare or Netlify keeps its `_headers` and `_redirects` only if its deploy tool picks them up, and the files are publicly readable.

### Confirmation

The test app builds `dist/_redirects` with a static, a dynamic and an on-demand redirect, writes no meta refresh page for them, and on bunny.net without edge rules answers 301 to a GET and 308 to a POST, with `build.format` `'directory'`, `'file'` and `'preserve'`. A static site builds `dist/_redirects` and no script.
