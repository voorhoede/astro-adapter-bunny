---
status: accepted (storage variables for standalone only, lazy deploy global and fail closed, `requires.env` from the schema, `BUNNY_API_KEY`, purge after publish and rollback); proposed (the rest)
date: 2026-10-28
---

# Build manifest version 1, plus optional fields, and the deploy line

## Context and problem statement

The adapter does not deploy. Two deploy tools read `.bunny/build.json`: the bunny-edge-deploy GitHub Action and the reference site's own deploy tool. The Action refuses a `manifestVersion` above 1 and ignores unknown fields; the reference site's tool reads a typed subset. Both prepend `globalThis.__BUNNY_DEPLOY__ = { id, assetPrefix, site, environment }` to the script, so a release carries its own deploy folder in storage, which is how code and files roll back together. Script variables are not part of a release, so the prefix cannot live in one.

## Considered options

- **Version 1 exactly.** Works today; the deploy tools keep hard-coded lists of secrets.
- **Version 1 plus optional fields.** Works today; moves hard-coded lists into data.
- **Version 2.** Freedom to rename, but the adapter and both tools must ship in lockstep.
- **The adapter's own deploy command.** Out of scope.

## Decision outcome

Version 1 plus optional fields, and keep the prepended line.

- **Fields:** `manifestVersion: 1`, `adapter.package` and `adapter.version`, `framework.name` and `framework.version`, `kind`, `script.{entry,type,bytes}` with `entry` pointing at `dist/index.js`, `assets.dir`, `assets.immutable: ["_astro/"]`, `requires.pullZone.{disableCookies:false,enableSmartCache:false,enableCacheSlice:false}` and `requires.env`.
- **`requires.env` (accepted).** `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_HOST` and the secret `BUNNY_STORAGE_KEY` for a standalone script, which reads every stored file through the Storage API. A middleware script needs none of them: it reads stored files through the CDN, and its error pages too, with a fetch to its own pull zone (measured on 2026-11-03: 200 in 140 ms as a miss and 22 ms as a hit, no loop). Plus entries derived from `env.schema`: only fields with `context: "server"` and `access: "secret"`, since public variables are inlined at build; `optional` when the field has `optional` or a `default`. Verified readable in an Astro 7.4.2 build.
- **Deploy global (accepted).** The script reads `__BUNNY_DEPLOY__` lazily on the first request and never throws at import. When it is missing, a request answers a `private, no-store` 500 with one clear log line and no storage read; the script never serves from the zone root. `assetPrefix` is required; `id`, `site` and `environment` are diagnostics only.
- **`BUNNY_API_KEY` (accepted).** A secret entry in `requires.env` for the default cache provider's `invalidate()`. The deploy tool already holds the key and sets it as a script secret at publish; it is never written into the build output.
- **Purge (accepted).** Pages cached at the CDN outlive a release, so a deploy tool purges the pull zone after a successful publish (after its smoke test) and after a successful rollback, and never after a failed one, which keeps the cache matching the live release.
- **The pull zone's cache override** (`CacheControlMaxAgeOverride: -1`, respect the origin) cannot be stated in version 1, since the Action accepts only booleans there. It is a documented deploy requirement.

Limits for the README and build warnings, measured on bunny.net in October 2026: 128 variables per script (129 breaks startup) and 2 KB per value at runtime; the API refuses values over 4,096 characters, and about 242 to 254 KB of values in total answers 431. The build warns above 128 derived variables.

### Consequences

- Good: no change to either deploy tool to adopt the adapter.
- Good: secrets stay out of the bundle and the manifest; only names travel, and no one keeps a list of secrets by hand.
- Bad: a secret read through `getSecret()` outside the schema is not listed; the fix is adding it to the schema.
- Bad: an optional field one reader ignores can drift silently.
- Bad: a manual deploy must prepend the line itself; the README shows how.

### Confirmation

The emitted manifest is validated against the rules both readers apply, and `requires.env` against a schema with secret, optional, defaulted and public fields. A build test loads the script without the deploy global: it does not throw and registers its handler, and a request then answers 500 without a storage read. A release is deployed once through each deploy tool.
