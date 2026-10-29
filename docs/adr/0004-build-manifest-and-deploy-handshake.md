---
status: accepted (storage variables required in both types, lazy deploy global and fail closed, `requires.env` from the schema, no `assets.reserved`); proposed (the rest)
date: 2026-10-28
---

# Build manifest version 1, plus optional fields, and the deploy line

## Context and problem statement

The reference site's deploy tool and the bunny-edge-deploy Action both read `.bunny/build.json`. The Action refuses `manifestVersion` above 1 and ignores unknown fields; the reference site's deploy tool reads a typed subset. Both prepend `globalThis.__BUNNY_DEPLOY__ = { id, assetPrefix, site, environment }` to the script so a release carries its own deploy folder, which is how code and files roll back together. Script variables are not part of a release, so the prefix cannot live in one. The Action's compat check imports the raw script before that line is prepended (read in its code, not run).

## Considered options

- **Version 1 exactly.** Works today; the reference site's deploy tool keeps hard-coded lists of secrets.
- **Version 1 plus optional fields.** Works today; moves hard-coded lists into data.
- **Version 2.** Freedom to rename; adapter and both tools must ship in lockstep.
- **The adapter's own deploy command.** Out of scope: the reference site's deploy design leads.

## Decision outcome

Version 1 plus optional fields, and keep the prepended line.

- Fields: `manifestVersion: 1`, `adapter.package`, `framework.name`, `kind`, `script.{entry,type,bytes}` with `entry` pointing at `dist/index.js`, `assets.dir`, `requires.pullZone.{disableCookies:false,enableSmartCache:false,enableCacheSlice:false}`, `requires.env`.
- Optional addition: `assets.immutable: ["_astro/"]`. No `assets.reserved`: server code ships inside the script, so no file under `dist/client` needs blocking or skipping (ADR 0007), and no deploy tool work is needed for it.
- **`requires.env` (accepted).** `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_HOST` and secret `BUNNY_STORAGE_KEY`, required in both script types, since both read prerendered error pages through the Storage API and standalone also reads stored files there. Server code no longer needs them (ADR 0007). They stay only as long as those reads go through the Storage API. Plus entries derived from `env.schema`: only `context: "server"` with `access: "secret"`, since public variables are inlined at build; `optional` when the field has `optional` or a `default`. Verified readable in an Astro 7.4.2 build.
- **Deploy global (accepted).** The runtime reads `__BUNNY_DEPLOY__` lazily on the first request and never throws at import. Missing: a `private, no-store` 500, one clear log line, no storage read. It never serves from the zone root. `assetPrefix` is required; `id`, `site`, `environment` are diagnostics only.
- **`BUNNY_API_KEY` (accepted).** A secret entry in `requires.env` for the default cache provider's `invalidate()`. The deploy tool already holds the key and sets it as a script secret at publish; it is never written into the build output.
- **Purge (accepted).** Pages cached at the CDN outlive a release, so a deploy tool purges the pull zone after a successful publish (after its smoke test) and after a successful rollback, and never after a failed one, which keeps the cache matching the release that is live.
- Every added field gets a line in a contract document in this repository, the derivation rule for `requires.env` included.

Known limits for the README and build warnings: 128 variables per script (129 breaks boot) and 2 KB per value at runtime (measured); the API refuses values over 4,096 characters, and about 242 to 254 KB of values in total answers 431 (measured in the prototype). The build warns above 128 derived variables.

### Consequences

- Good: no change to either deploy tool to adopt the adapter.
- Good: secrets stay out of the bundle and the manifest; only names travel (R-ENV-2). No one keeps a list of secrets by hand.
- Bad: the storage key is required even in middleware, where static files need no credentials.
- Bad: a secret read through `getSecret()` outside the schema is not listed; the fix is adding it to the schema.
- Bad: an optional field one reader ignores can drift silently.
- Bad: a manual deploy must prepend the line itself; the README shows how.
- Bad: `CacheControlMaxAgeOverride: -1` cannot be stated in v1 (the Action accepts booleans only there); it is a documented deploy requirement instead.

### Confirmation

M2 validates the emitted manifest against the rules both readers apply (`docs/research/deploy-contract.md` section 1) and checks `requires.env` against a schema with secret, optional, defaulted and public fields. A build test imports the script without the global: it does not throw and registers its handler; a request then answers 500 with no storage read. M4 deploys through the reference site's deploy tool and the Action.
