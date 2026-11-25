---
status: accepted; open (whether bunny.net's CLI accepts the manifest)
date: 2026-10-28, rewritten 2026-11-15, 2026-11-24 and 2026-11-25
---

# A build manifest in bunny.net's format

## Context and problem statement

The adapter does not deploy. A deploy uploads `dist/client` to a storage zone and publishes `dist/index.js` as the Edge Script, and a deploy tool has to know which of the two a build has, which variables the script needs, and how the site is configured.

bunny.net's own adapters write `.bunny/build.json` at the project root, which its CLI reads instead of knowing each framework. Its contract (read on 2026-11-15) gives `manifestVersion`, `adapter`, `framework`, `kind` (`ssr` or `static`), `script` (`entry`, `type` `standalone` or `middleware`, `bytes`), `assets.dir`, `requires` (`pullZone`, `storage`, `env`) and `dev`, and says the CLI ignores optional fields it does not know. Its CLI puts each release in a folder `deploys/<id>` of one storage zone, and either names the folder in a line at the top of the script (`globalThis.__BUNNY_DEPLOY__`) or, for `bunny sites`, serves it through an edge rule and blocks `/deploys/*`.

A script that serves releases from folders has to strip the folder from every path before routing, `Astro.url` and the cache rules, and add it back for storage. When every release has a storage zone of its own, each release's files sit at the root of its zone, and the script needs none of that.

Measured on bunny.net: 128 variables per script (129 breaks startup) and 2 KB per value at runtime; the API refuses values over 4,096 characters, and about 242 to 254 KB of values in total answers 431 (October 2026). A full zone purge took effect within 30 s (2026-11-03).

Astro encrypts the props of a server island with a key made per build. On 2026-11-09 a page cached from one build sent props a script from another build could not read, and the island answered 400.

## Considered options

- **No manifest.** Nothing to write, but a deploy tool has to read the Astro config and the build output to learn what bunny.net's manifest already says.
- **Our own manifest format.** Free to shape, but bunny.net's CLI cannot read it.
- **bunny.net's manifest format with our fields under one key.**

For where a release's files live:

- **Deploy folders in one storage zone,** with the script reading the folder from a request header an edge rule sets, or from bunny.net's script line. Works with bunny.net's CLI, at the cost of folder handling on every request.
- **The root of a storage zone per release.** The script reads paths as they are.

## Decision outcome

bunny.net's manifest format, and files at the root. The build writes `.bunny/build.json` in bunny.net's shape, with `type: "middleware"`, the `astro:env` secrets in `requires.env`, and our own fields under `astroAdapterBunny`: `trailingSlash`, `base`, `buildFormat`, `assetsDir`, and the paths of `dist/client/_redirects` and `dist/client/_headers`. The script serves the files at the root of its pull zone's storage zone, and knows no deploy folder.

### Consequences

- Good: a deploy tool reads one file, in a format bunny.net's tooling shares.
- Good: the script handles no folder, so a path means the same for routing, `Astro.url`, the cache rules and storage.
- Bad: a release deployed by bunny.net's CLI into `deploys/<id>` is not served, since the script reads from the root.
- Bad: whether bunny.net's CLI accepts this manifest, and what `bunny lab deploy` does with a middleware script, is untested.
- Bad: a file in the storage zone from an earlier build stays readable and wins over an on-demand route on the same path, so a deploy into a zone that is not new has to remove files the build no longer has.
- Bad: three pull zone settings the script needs, cache expiration, query strings and cache slicing, have no field in bunny.net's shape, so a deploy tool still learns them from the deploy specification.

### Confirmation

The test app writes the manifest with every field above, a static site writes `kind: "static"` without `script` or `requires`, and a custom `outDir` changes the paths. On bunny.net the test app passes its checks with its files at the root of the storage zone.
