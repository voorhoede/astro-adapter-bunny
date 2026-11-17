---
status: accepted; open (whether bunny.net's CLI accepts the manifest)
date: 2026-10-28, rewritten 2026-11-15
---

# A build manifest in bunny.net's format, and deploy folders through edge rules

## Context and problem statement

The adapter does not deploy. A deploy uploads `dist/client` to the storage zone and publishes `dist/index.js` as the Edge Script, and a deploy tool has to know which of the two a build has, which variables the script needs, and how the site is configured. Script variables are not part of a release, so a release folder cannot be named in one.

bunny.net's own adapters write `.bunny/build.json` at the project root, which its CLI reads instead of knowing each framework. Its contract (read on 2026-11-15) gives `manifestVersion`, `adapter`, `framework`, `kind` (`ssr` or `static`), `script` (`entry`, `type` `standalone` or `middleware`, `bytes`), `assets.dir`, `requires` (`pullZone`, `storage`, `env`) and `dev`, and says the CLI ignores optional fields it does not know. Its CLI puts each release in `deploys/<id>` and either names the folder in a line at the top of the script (`globalThis.__BUNNY_DEPLOY__`) or, for `bunny sites`, serves it through an edge rule and blocks `/deploys/*`.

Measured on bunny.net: 128 variables per script (129 breaks startup) and 2 KB per value at runtime; the API refuses values over 4,096 characters, and about 242 to 254 KB of values in total answers 431 (October 2026). A full zone purge took effect within 30 s (2026-11-03). On 2026-11-15, an edge rule with the action "origin storage" served a release from `deploys/<id>`, a block rule answered 403 for `/deploys/*`, and the script saw the path with the folder in front.

Astro encrypts the props of a server island with a key made per build. On 2026-11-09 a page cached from one build sent props a script from another build could not read, and the island answered 400. A fixed `ASTRO_KEY` in the build environment keeps the key across builds.

## Considered options

- **No manifest and no deploy folders.** Nothing to parse, but files and code do not roll back together, and every stored file stays readable.
- **Our own manifest format.** Free to shape, but bunny.net's CLI cannot read it.
- **bunny.net's manifest format with our fields under one key, and deploy folders through edge rules, with the script reading the folder from a request header or from bunny.net's script line.**

## Decision outcome

The third. The build writes `.bunny/build.json` in bunny.net's shape, with `type: "middleware"`, the `astro:env` secrets in `requires.env`, and our own fields under `astroAdapterBunny`: `trailingSlash`, `buildFormat`, `assetsDir`, the paths of `dist/client/_redirects` and `dist/client/_headers` and the name of the deploy folder header. A deploy tool serves a release from `deploys/<id>` through an edge rule that also sets `X-Bunny-Deploy`; the script strips that folder before routing and adds it back for storage. Without the header the script adds the folder bunny.net's CLI names in `__BUNNY_DEPLOY__`, and without either it reads from the root.

### Consequences

- Good: a deploy tool reads one file, in a format bunny.net's tooling shares.
- Good: with deploy folders, files and code roll back together, and earlier releases cannot be requested.
- Bad: whether bunny.net's CLI accepts this manifest, and what `bunny lab deploy` does with a middleware script, is untested.
- Bad: a deploy to the root still works, and then files from an earlier build stay readable until they are overwritten or removed.
- Bad: two pull zone settings the script needs, cache expiration and query strings, have no field in bunny.net's shape, so a deploy tool still learns them from the deploy specification.

### Confirmation

The test app writes the manifest with every field above, a static site writes `kind: "static"` without `script` or `requires`, and a custom `outDir` changes the paths. On bunny.net the test app passed its 56 checks from the root, behind the deploy folder rules, and from a folder named only in `__BUNNY_DEPLOY__`.
