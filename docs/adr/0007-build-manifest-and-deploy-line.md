---
status: accepted
date: 2026-10-28, updated 2026-11-04
---

# Build manifest version 1, and the deploy line

## Context and problem statement

The adapter does not deploy. Two deploy tools read `.bunny/build.json`: the bunny-edge-deploy GitHub Action and the reference site's own deploy tool. The Action refuses a `manifestVersion` above 1 and ignores unknown fields; the reference site's tool reads a typed subset. Both prepend `globalThis.__BUNNY_DEPLOY__ = { id, assetPrefix, site, environment }` to the script, so a release carries its own deploy folder in storage, which is how code and files roll back together. Script variables are not part of a release, so the folder cannot live in one.

## Considered options

- **Version 1 exactly.** Works today, but the deploy tools keep hard-coded lists of secrets.
- **Version 1 plus optional fields.** Works today, and moves those lists into data.
- **Version 2.** Freedom to rename, but the adapter and both tools must ship in lockstep.
- **The adapter's own deploy command.** Out of scope.

## Decision outcome

Version 1 plus optional fields, and the prepended line.

- **Fields:** `manifestVersion: 1`, `adapter.package` and `adapter.version`, `framework.name` and `framework.version`, `kind`, `script.{entry,type,bytes}` with `entry` pointing at `dist/index.js`, `assets.dir`, `assets.immutable: ["_astro/"]`, `requires.pullZone.{disableCookies:false,enableSmartCache:false,enableCacheSlice:false}` and `requires.env`.
- **`requires.env`.** `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_HOST` and the secret `BUNNY_STORAGE_KEY` for a standalone script, which reads every stored file through the Storage API. A middleware script needs none of them: it reads stored files through the CDN, and its error pages with a fetch to its own pull zone (measured on 2026-11-03: 200 in 140 ms as a miss and 22 ms as a hit, no loop). The optional secret `BUNNY_API_KEY` is listed for the cache provider's `invalidate()`; the deploy tool already holds it and never writes it into the build. Every field in `env.schema` with `context: "server"` and `access: "secret"` is listed too, `optional` when it has `optional` or a `default`; public variables are inlined at build.
- **Deploy global.** The script reads `__BUNNY_DEPLOY__` lazily on the first request and never throws at import. When it is missing, a request answers a `private, no-store` 500 with one clear log line and no storage read; the script never serves from the zone root. `assetPrefix` is required; `id`, `site` and `environment` are diagnostics only.
- **Purge.** Pages cached at the CDN outlive a release, so the deploy tool purges the whole pull zone after a successful publish (after its smoke test) and after a successful rollback, never after a failed one. A full zone purge took effect within 30 s on a standalone script (measured on 2026-11-03).
- **The pull zone's cache override** (`CacheControlMaxAgeOverride: -1`, respect the origin) cannot be stated in version 1, since the Action accepts only booleans there. It is a documented deploy requirement.

Variable limits, measured on bunny.net in October 2026: 128 variables per script (129 breaks startup) and 2 KB per value at runtime; the API refuses values over 4,096 characters, and about 242 to 254 KB of values in total answers 431.

### Consequences

- Good: neither deploy tool has to change to adopt the adapter.
- Good: secrets stay out of the bundle and the manifest; only names travel, and nobody keeps a list of secrets by hand.
- Bad: a secret read through `getSecret()` outside the schema is not listed; the fix is adding it to the schema.
- Bad: an optional field one reader ignores can drift silently.
- Bad: a manual deploy must prepend the line itself.

### Confirmation

The emitted manifest and `requires.env` are tested against a schema with secret, optional, defaulted and public fields, per script type. A build test loads the script without the deploy global: it does not throw and registers its handler, and a request then answers 500 without a storage read.
