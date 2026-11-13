---
status: accepted
date: 2026-10-28, rewritten 2026-11-10
---

# No build manifest or deploy line

## Context and problem statement

The adapter does not deploy. A deploy uploads `dist/client` to the storage zone and publishes `dist/index.js` as the Edge Script. Deploy tools for bunny.net can read a build manifest such as `.bunny/build.json`, and can prepend a line to the script that names a folder in storage per release, so code and files roll back together. Script variables are not part of a release, so such a folder cannot live in one.

Measured on bunny.net in October 2026: 128 variables per script (129 breaks startup) and 2 KB per value at runtime; the API refuses values over 4,096 characters, and about 242 to 254 KB of values in total answers 431. A full zone purge took effect within 30 s (2026-11-03).

Astro encrypts the props of a server island with a key made per build. On 2026-11-09 a page cached from one build sent props a script from another build could not read, and the island answered 400. A fixed `ASTRO_KEY` in the build environment keeps the key across builds.

## Considered options

- **A manifest and a deploy line**, read and written by deploy tooling.
- **Neither: the build writes only `dist/client`, plus `dist/index.js` when the site has a server.**

## Decision outcome

Neither. The script reads stored files from the root of the storage zone, and a release is one upload of `dist/client` plus, when the build wrote one, one publish of `dist/index.js` from the same build. The deploy tooling owns the pull zone settings, the purge after a release and `ASTRO_KEY`.

### Consequences

- Good: nothing for a deploy tool to parse, and nothing to prepend.
- Bad: files and code do not roll back together, and files from an earlier build stay readable until they are overwritten or removed.
- Bad: a deploy tool must know the pull zone settings and variables from documentation, not from the build.

### Confirmation

A build writes `dist/client`, Astro's own `dist/server`, and `dist/index.js` when there is a server, and nothing else. Uploading `dist/client` to a storage zone and `dist/index.js` to an Edge Script serves the site.
