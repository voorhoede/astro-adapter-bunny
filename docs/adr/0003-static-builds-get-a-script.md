---
status: accepted
date: 2026-10-28, rewritten 2026-11-10
---

# Static builds still get a script

## Context and problem statement

`setAdapter()` forces `buildOutput: 'server'` unless the adapter passes `'static'`. With the default, a fully prerendered site still gets a server bundle and a script to deploy. Astro exposes the build output the project needs in `astro:config:done`, so an adapter can pass it back and let a static site deploy as files only. Astro reports a fully prerendered site with a `server:defer` island as `buildOutput: "static"`, but still emits a server entry for it (verified in an Astro 7.4.2 build).

Built on 2026-11-10: a site with two prerendered pages, no `output` setting and a public file built a script of 568 kB, and through it every page and the file answered 200 and a missing path 404.

## Considered options

- **Read `buildOutput` and pass it back.** A static site deploys as files, but then has no script to answer redirects or set cache headers, and the deploy needs a second shape.
- **Always server.**

## Decision outcome

Always server. The adapter does not pass `buildOutput`, so every build writes `dist/index.js` next to `dist/client`, and every site deploys the same way.

### Consequences

- Good: one deploy shape, and the same cache headers on a static site as on any other.
- Good: a prerendered site with a server island needs no special case.
- Bad: a fully static site pays for a script run on every cache miss, and for a script it does not need.

### Confirmation

A build without on-demand routes writes `dist/index.js`, and the script serves its pages and files.
