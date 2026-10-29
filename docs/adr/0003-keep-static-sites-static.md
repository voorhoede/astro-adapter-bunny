---
status: proposed (static builds); accepted (island detection, `staticHeaders` only for `buildOutput: "server"`, `_headers` and `_redirects` through the deploy tool)
date: 2026-10-28
---

# Keep static builds static

## Context and problem statement

`setAdapter()` forces `buildOutput: 'server'` unless the adapter passes `'static'`. With the default, a fully prerendered site still gets a server bundle, a script to deploy, and needs a `previewEntrypoint`. Astro exposes the build output the project needs as a live value in `astro:config:done`, readable before `setAdapter()`.

## Considered options

- **Always server.** One deploy shape, but every static site pays for a script run on every cache miss.
- **Read `buildOutput` and pass it back.**
- **An option** to choose. Hands the caller a decision Astro already made from their routes.

## Decision outcome

Read and pass back. A site with no on-demand route, no server islands and no actions builds static: `dist/client` only, `.bunny/build.json` with `kind: "static"` and no `script`, and Astro's own preview. Redirects stay as Astro's meta-refresh files (`build.redirects` is left alone in this case).

- **Headers and redirects (accepted).** `public/_headers` and `public/_redirects` land in `dist/client` unchanged; the deploy tool turns them into bunny.net edge rules (ADR 0008). If they do not fit the 50-rule limit, the deploy fails with a clear message. The adapter warns at build when the rule count exceeds 50.
- **`staticHeaders` stays off (accepted).** With it on, Astro moves the CSP from a `<meta>` tag into its header map (verified in an Astro 7.4.2 build). Without a script nothing would serve that header, so a static site would silently lose its CSP. The adapter turns `staticHeaders` on only when `buildOutput` is `"server"`, since that is the last value it can read before `setAdapter()`. An island site (below) reports `"static"`, so it keeps its CSP in the HTML (L1 step 2).
- **Server islands (accepted).** Astro reports a fully prerendered site with a `server:defer` island as `buildOutput: "static"`, and the route list cannot tell it apart from one without the island, but Astro still emits a server entry for it (L1 step 1). So there is no build failure: in `astro:build:done` the adapter emits a script whenever a server entry exists, whatever `buildOutput` said. No option.

### Consequences

- Good: a static site deploys as files, which the bunny-edge-deploy Action already supports, `_headers` and `_redirects` included (read in its code, not run live).
- Good: no option.
- Bad: `staticCacheControl` cannot apply without a script; caching of a static site depends on the zone and the deploy tool. Edge rules turn only a `max-age` into a browser cache time.
- Bad: which Cloudflare `_headers` and `_redirects` features become edge rules is the deploy tool's subset, not the adapter's (placeholders and mid-path splats are skipped by the Action today).
- Bad: the reference site's deploy tool rejects `kind: "static"`. The reference site always has on-demand routes, so this does not reach it.

### Confirmation

M2 builds a fully prerendered test app and checks there is no script, the manifest says `static`, the CSP is still a `<meta>` tag, `_headers` and `_redirects` are in `dist/client`, and a 51-rule fixture warns. A fixture with one `server:defer` on a prerendered site gets a script ([L1 note](../spikes/2026-10-28-l1.md)).
