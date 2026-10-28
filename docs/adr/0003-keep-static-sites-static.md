---
status: proposed (static builds and island detection); accepted (`staticHeaders` only with a script, `_headers` and `_redirects` through the deploy tool)
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
- **`staticHeaders` stays off (accepted).** With it on, Astro moves the CSP from a `<meta>` tag into its header map (verified in an Astro 7.4.2 build). Without a script nothing would serve that header, so a static site would silently lose its CSP. The adapter turns `staticHeaders` on only when a script is emitted.
- **Server islands (proposed).** Astro may report a fully prerendered site with a `server:defer` island as static, which would ship islands that 404. If L1 step 1 confirms this and `astro:config:done` cannot see the island, `astro:build:done` fails the build when prerendered HTML references `/_server-islands/`, with a message on how to get a server build (one on-demand route). No option.

### Consequences

- Good: a static site deploys as files, which the bunny-edge-deploy Action already supports, `_headers` and `_redirects` included (read in its code, not run live).
- Good: no option.
- Bad: `staticCacheControl` cannot apply without a script; caching of a static site depends on the zone and the deploy tool. Edge rules turn only a `max-age` into a browser cache time.
- Bad: which Cloudflare `_headers` and `_redirects` features become edge rules is the deploy tool's subset, not the adapter's (placeholders and mid-path splats are skipped by the Action today).
- Bad: the reference site's deploy tool rejects `kind: "static"`. The reference site always has on-demand routes, so this does not reach it.

### Confirmation

M2 builds a fully prerendered test app and checks there is no script, the manifest says `static`, the CSP is still a `<meta>` tag, `_headers` and `_redirects` are in `dist/client`, and a 51-rule fixture warns. L1 step 1 decides the island check; if it ships, a fixture with one `server:defer` on a prerendered site fails the build.
