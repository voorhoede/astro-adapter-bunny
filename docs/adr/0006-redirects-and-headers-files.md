---
status: accepted
date: 2026-10-28, rewritten 2026-11-15 and 2026-11-17
---

# Redirects and headers files for edge rules

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

With `security.csp`, Astro puts each prerendered page's policy in a `<meta>` tag, unless the adapter declares `staticHeaders`; then Astro leaves the tag out and hands the adapter each page's headers in `routeToHeaders`. Measured on 2026-11-17, edge rules with the action "Set response header" and a trigger "response header is missing" set each prerendered page's own policy, and an on-demand page kept the policy it sent itself.

## Considered options

- **Parse `_headers` and `_redirects` at build and apply them in the script**, with Cloudflare's semantics. Portable, but a parser and a matcher of our own.
- **Keep Astro's meta refresh pages.** Nothing for a deploy tool to do, but every redirect to a prerendered page answers 200.
- **Real redirects from the script, and Astro's redirects written to a file a deploy tool turns into edge rules.**

## Decision outcome

The third, for redirects and for the policies of prerendered pages. The adapter sets `build.redirects: false` and writes Astro's `redirects` to `dist/client/_redirects`, one line per redirect: source, target and status, with `:param` for a dynamic segment and `*` and `:splat` for a rest segment. The script renders a redirect route itself, so a site with a script answers a real 301 or 308 without any edge rule. A deploy tool turns the file into edge rules, which a static site needs and a site with a script may use to answer before the script.

The adapter declares `staticHeaders` and writes each prerendered page's Content-Security-Policy to `dist/client/_headers`, one block per page; other headers Astro saw while prerendering, such as an i18n fallback's `Location`, are left out. Both files are appended to the site's own `public/_redirects` and `public/_headers`, whose lines stay first. The adapter does not parse the site's lines. A header on rendered pages goes in Astro middleware.

### Consequences

- Good: redirects answer 301 or 308, as with the official adapters, and dynamic redirects work.
- Good: a deploy tool gets the redirects in the format Netlify and Cloudflare use.
- Bad: a static site depends on its deploy tool for redirects; without edge rules they answer 404.
- Bad: an edge rule answers 301 where Astro answers 308 for a POST, and holds a parameter only as a whole path segment.
- Good: a prerendered page gets its policy as a header, so the directives the CSP specification ignores in a `<meta>` tag, such as `frame-ancestors`, are not lost.
- Good: a site moving from Cloudflare or Netlify keeps its `_headers` and `_redirects` lines in the files a deploy tool reads.
- Bad: stored files get only `Cache-Control` and the policies, unless the site's own `_headers` adds more and the deploy tool applies it.
- Bad: every distinct policy takes an edge rule, from the same 50 as the redirects.
- Bad: both files are uploaded with `dist/client` and are publicly readable, unless the deploy tool skips them.

### Confirmation

The test app builds `dist/client/_redirects`, with its own lines first, and a static, a dynamic and an on-demand redirect, writes no meta refresh page for them, and on bunny.net without edge rules answers 301 to a GET and 308 to a POST, with `build.format` `'directory'`, `'file'` and `'preserve'`. A static site builds `dist/client/_redirects` and no script. With `security.csp`, the test app builds `dist/client/_headers` with its own lines first and no `<meta>` policy, and on bunny.net the edge rules made from it set each prerendered page's policy.
