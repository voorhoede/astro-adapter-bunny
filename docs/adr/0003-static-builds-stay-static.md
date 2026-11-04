---
status: accepted
date: 2026-10-28, updated 2026-11-04
---

# Static builds stay static

## Context and problem statement

`setAdapter()` forces `buildOutput: 'server'` unless the adapter passes `'static'`. With the default, a fully prerendered site still gets a server bundle and a script to deploy. Astro exposes the build output the project needs as a live value in `astro:config:done`, readable before `setAdapter()`.

## Considered options

- **Always server.** One deploy shape, but every static site pays for a script run on every cache miss.
- **Read `buildOutput` and pass it back.**
- **An option to choose.** It hands the caller a decision Astro already made from their routes.

## Decision outcome

Read and pass back. A site with no on-demand route, no server island and no action builds static: `dist/client` only, and `.bunny/build.json` with `kind: "static"` and no `script`. The deploy tool uploads it as files.

- **Server islands.** Astro reports a fully prerendered site with a `server:defer` island as `buildOutput: "static"`, and its route list cannot tell it apart from one without the island, but Astro still emits a server entry for it (verified in an Astro 7.4.2 build). So the adapter emits a script in `astro:build:done` whenever a server entry exists, whatever `buildOutput` said.
- **`staticHeaders` only with a script.** With it on, Astro moves the Content Security Policy from a `<meta>` tag into its header map (verified in an Astro 7.4.2 build). Without a script nothing would serve that header, so a static site would silently lose its CSP. The adapter turns `staticHeaders` on only when `buildOutput` is `"server"`, so an island site keeps its CSP in the HTML.
- **Astro config redirects** in a static build are appended to `dist/client/_redirects` after the project's rules, since no script would answer them.

### Consequences

- Good: a static site deploys as files, with no option.
- Bad: without a script, caching of a static site depends on the pull zone and the deploy tool.

### Confirmation

A fully prerendered fixture builds without a script, its manifest says `static`, the CSP is still a `<meta>` tag, and Astro's redirects land in `_redirects`. A prerendered fixture with one `server:defer` island gets a script.
