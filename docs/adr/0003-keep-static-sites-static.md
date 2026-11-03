---
status: proposed (static builds); accepted (island detection, `staticHeaders` only for `buildOutput: "server"`, `_headers` and `_redirects` through the deploy tool)
date: 2026-10-28
---

# Keep static builds static

## Context and problem statement

`setAdapter()` forces `buildOutput: 'server'` unless the adapter passes `'static'`. With the default, a fully prerendered site still gets a server bundle and a script to deploy. Astro exposes the build output the project needs as a live value in `astro:config:done`, readable before `setAdapter()`.

## Considered options

- **Always server.** One deploy shape, but every static site pays for a script run on every cache miss.
- **Read `buildOutput` and pass it back.**
- **An option** to choose. Hands the caller a decision Astro already made from their routes.

## Decision outcome

Read and pass back. A site with no on-demand route, no server islands and no actions builds static: `dist/client` only, `.bunny/build.json` with `kind: "static"` and no `script`, and Astro's own preview.

- **Headers and redirects (accepted).** `public/_headers` and `public/_redirects` land in `dist/client` unchanged, and the deploy tool turns them into bunny.net edge rules. A pull zone takes 50 edge rules, so the adapter warns at build above 50 rules and the deploy tool fails with a clear message. Redirects from Astro's own config are appended to `dist/client/_redirects` after the project's rules, since nothing else would answer them.
- **`staticHeaders` stays off for static builds (accepted).** With it on, Astro moves the Content Security Policy from a `<meta>` tag into its header map (verified in an Astro 7.4.2 build). Without a script nothing would serve that header, so a static site would silently lose its CSP. The adapter turns `staticHeaders` on only when `buildOutput` is `"server"`.
- **Server islands (accepted).** Astro reports a fully prerendered site with a `server:defer` island as `buildOutput: "static"`, and its route list cannot tell it apart from one without the island, but Astro still emits a server entry for it (verified in an Astro 7.4.2 build). So in `astro:build:done` the adapter emits a script whenever a server entry exists, whatever `buildOutput` said. Such a site keeps its CSP in the HTML.

### Consequences

- Good: a static site deploys as files.
- Good: no option.
- Bad: without a script, caching of a static site depends on the pull zone and the deploy tool; edge rules turn only a `max-age` into a browser cache time.
- Bad: which `_headers` and `_redirects` features become edge rules is the deploy tool's subset, not the adapter's.

### Confirmation

A fully prerendered test app builds without a script, its manifest says `static`, the CSP is still a `<meta>` tag, `_headers` and `_redirects` are in `dist/client`, and a fixture with 51 rules warns. A prerendered fixture with one `server:defer` island gets a script.
