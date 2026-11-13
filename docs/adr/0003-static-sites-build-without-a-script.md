---
status: accepted; open (serving a static site without a script on bunny.net)
date: 2026-10-28, rewritten 2026-11-13
---

# Static sites build without a script

## Context and problem statement

`setAdapter()` forces `buildOutput: 'server'` unless the adapter passes another value. With that default, a fully prerendered site still gets a server bundle and a script to deploy. Astro hands the build output the project needs to `astro:config:done`, so an adapter can pass it back.

With `buildOutput: 'static'`, Astro writes the client files to `outDir` and the server files to `outDir` too, unless the adapter sets `preserveBuildClientDir` and `preserveBuildServerDir`. Astro reports a prerendered site with a `server:defer` island as `static`, but still emits a server entry for it. `astro:build:done` does not say whether a server was built; `astro:build:ssr` only runs when Astro emits a server chunk.

Built with Astro 7.4 on 2026-11-13, with both preserve flags set:

- A site with only prerendered pages wrote `dist/client` and an empty `dist/server`, and `astro:build:ssr` did not run.
- The same site with a `server:defer` island wrote `dist/server/entry.mjs`, and `astro:build:ssr` ran.
- Without `preserveBuildServerDir`, that island site wrote `entry.mjs` straight into `dist/`.

## Considered options

- **Always server.** One deploy shape, but a static site pays for a script it does not need.
- **Pass `buildOutput` back without the preserve flags.** The upload folder becomes `dist/` for static sites and `dist/client` for others, and a static site's server entry and `dist/index.js` land in the folder that gets uploaded.
- **Pass `buildOutput` back with both preserve flags, and bundle only when `astro:build:ssr` ran.**

## Decision outcome

The third. The adapter passes Astro's `buildOutput` back with `preserveBuildClientDir` and `preserveBuildServerDir`, records when `astro:build:ssr` runs, and writes `dist/index.js` only then.

### Consequences

- Good: a fully static site deploys as files only, and every build uploads `dist/client`.
- Good: a static site with a server island still gets its script.
- Bad: a deploy has two shapes: with or without `dist/index.js`.
- Bad: without a script, `Cache-Control` and the 404 page have to come from the pull zone and the storage zone.
- Bad: relying on `astro:build:ssr` to signal a server build follows Astro's code, not its documented contract. The official Vercel adapter (11.0) relies on it the same way.

### Confirmation

The three builds above, and the test app, which still writes `dist/index.js`. A static site has not yet been served live through a pull zone without a script.
