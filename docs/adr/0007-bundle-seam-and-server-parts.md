---
status: accepted (always split, Rollup and SystemJS `system.js`, grouping, the per-target budget, eager size thresholds, parts never public, location under `_bunny/server/`, own hash check); proposed (how parts reach the script)
date: 2026-10-28
---

# Server code always in parts, loaded by SystemJS behind our own module

## Context and problem statement

Bunny takes one script file. Startup goes past 500 ms at about 2 MB of real code, and a 9.5 MB script failed after its first request (measured); other sources saw failures from about 7.5 MB, and the prototype saw specific builtins fail at any size, so the limit looks like startup work rather than bytes **[guess, in two sources]**. The reference site's bundle is 2.74 MB only because Shiki is aliased out. `import()` fails in a Bunny isolate in every form: a `data:`, `blob:`, `https:` and relative specifier (S1.1, measured). Indirect `(0, eval)` and `new Function` both work there (S1.1), and `new Function` worked up to at least 18 MB (measured in the prototype). The prototype split a 10.7 MB Astro bundle at its own `import()` boundaries into a 467 KB eager part and cut cold medians by about 30%. Without grouping, one request there could need more than the 50 subrequests a request may make (448 modules, measured count).

## Considered options

For when to split:

- **One module, permanently.** Shiki-sized dependencies stay out of reach.
- **Split above a size threshold.** Small sites keep the simple path, but there are two code paths and the threshold is a guess.
- **Always split, no threshold, no option.**

For the module runtime that loads parts:

1. **SystemJS behind our own module.** A specified loader: `s.js` is 7,976 bytes minified (`systemjs@6.15.1`, `dist/s.min.js`), the full `system.js` 12,325 bytes (`dist/system.min.js`). Without a `document`, it fetches through a `shouldFetch` and `fetch` hook we supply and evaluates with indirect `eval`. `s.js` loaded a Rollup-split chain of `System.register` parts from the Storage API on bunny.net, a part shared through a static import included (S1.1). But `s.js` caches a failed fetch for the life of the isolate and has no `System.delete`; `system.js` has it, and deleting the failed entry then importing again fetched once more and succeeded (L2 step 3).
2. **Our own `System.register` runtime.** We would own live bindings, cycles and top-level await that SystemJS already implements.
3. **webpack or rspack with their own chunk loader.** A second bundler next to Vite. Heavy for one feature.

## Decision outcome (accepted)

Always split in v1, with SystemJS (option 1), using the full `dist/system.min.js` rather than `s.js`, because `s.js` would turn one transient fetch error into a part that fails until the isolate ends (L2).

- **Build.** `build/bundle` runs Rolldown to ES modules, then Rollup to `System.register`, because Rolldown 1.2.15 has no `system` format and Rollup 4.66.0 has (both verified from their type definitions). Rollup and `systemjs` become package dependencies; `system.js` is bundled into the eager script. CI installs with `npm ci --ignore-scripts`, so a dependency that needs an install script fails the build and runtime tests.
- **Grouping is mandatory.** Rollup chunking, one chunk per `import()` target plus shared chunks, with `output.experimentalMinChunkSize` at 32 kB. The merged output is kept only when every `import()` target still has a chunk of its own; otherwise `build/bundle` uses the unmerged output. A packer that groups parts into one fetch only if Rollup's chunking cannot meet the budget.
- **Budget, at build.** At most 8 parts for each target the eager script imports directly (pages, middleware, the session driver, islands), checked by `build/bundle`. Deeper targets, such as Shiki grammars, are not budgeted at build: in the L2 test app one grammar statically reached 10 parts. Sequential rounds (a page, then what it imports) are not checked at build either.
- **Budget, at runtime (open).** No guard for now. S1 measured 400 sequential fetches in one request without hitting a limit, so the documented 50 subrequests was not enforced there ([note](../spikes/2026-10-28-s1.md)). Whether a request can fail on subrequests is checked later; a guard is added only if it can.
- **Eager script size (accepted).** Fail above 7 MB raw; warn above 1 MB. Measured on 2026-10-28 (S1 step 2): a 7.3 MB script of generated code answered every cold request in 1.2 to 1.3 s, a 9.4 MB one never answered, and 1 MB cost 0.17 to 0.31 s cold. Parts have no script limit but count against 128 MB memory and parse time (about 30 ms per MB, measured in the prototype).
- **Where parts live.** In the assets dir under `_bunny/server/`, with the content hash in the name, so they upload and roll back with the release without a deploy tool change. Not a dotfile (one deploy tool skips those), and sorts after `_astro`. The manifest names the prefix in `assets.reserved` (ADR 0004).
- **How they reach the script (proposed).** Behind `server-parts` only, so the choice stays inside one module:
  - Primary: bunny.net's regional Cache API. On a miss, fetch the part from the Storage API and store it in the Cache API. Nothing is publicly addressable.
  - Fallback on the same path: the Storage API alone, main region only (about 420 ms against about 85 ms from a replica, from New York, measured).
  - Alternative if the Cache API falls short: fetch through our own pull zone with a secret header, plus an edge rule rejecting requests without it. Costs a deploy tool change (the edge rule, a shared secret and its rotation) and recognizing the self-request in `onOriginRequest` before `routing`. Standalone still reads from the Storage API on a miss.
  - Decision rule: keep the Cache API if S1 shows it fast enough and parts stay cached long enough. Otherwise switch to the alternative, but only if S1 step 3b shows an edge rule blocks a request without the header even when the object is already in the CDN cache.
- **How they load.** `server-parts` owns `system.js`, its fetch hook and an import map with a SHA-256 per part. Nothing is loaded at import; the first request that needs a page loads its parts. A failed fetch is not remembered: `server-parts` deletes the failed entry with `System.delete`, so the next import retries. Concurrent first imports of one part share one fetch (both loaders, L2 step 3).

### Security (accepted)

- **Parts are never publicly reachable.** A mistake can inline a secret into server code, so server code must not be public. `routing` answers not found for `/_bunny/` in both types (ADR 0002), so a visitor's cache miss never reaches the file. The proposed primary transport keeps parts out of the public CDN cache entirely; the alternative relies on the edge rule holding on cache hits, which S1 must show first. Prerendered error pages use the same read path.
- **Tampering.** The release embeds a SHA-256 per part, and the hook checks it before evaluating, using `crypto.subtle` captured at startup. The prototype verified that captured references survive app code patching globals. Hashing costs about 15 ms for 10 MB on bunny.net, against tens of milliseconds for fetching a part from the same region (S1.1). We do not rely on `integrity` in Bunny's `fetch`. A mismatch fails closed with a `private, no-store` 500.
- **Code evaluation.** Parts come from our own storage (no third-party processor), are immutable per deploy (a rollback takes them along), and carry a hash. The reference site's maintainers review this section before migrating.

### Consequences

- Good: Shiki-sized dependencies work without aliasing; one code path for every site.
- Good: we do not own a module runtime. `build/bundle` and `server-parts` are the only modules that know parts exist.
- Good: indirect `eval`, `new Function` and a SystemJS chain from the Storage API are verified on bunny.net (S1.1). If indirect `eval` ever stops working, `new Function` is the fallback.
- Bad: two dependencies, one with a native binary. SystemJS has had no release since 6.15.1 on 2024-04-27, about 30 months.
- Bad: `system.js` adds about 4 kB to the eager script over `s.js`.
- Bad: a budget at build covers only directly imported targets, so a deep chain is not bounded at all until the open runtime question is settled.
- Bad: every first use of a part per isolate costs a subrequest, and a Cache API miss costs a Storage API fetch at the main region (about 420 ms from New York, measured). Cache API latency and eviction on Bunny are unmeasured (S1 step 3a). Whether a small app split is slower than one module is unmeasured (S1 step 3c).
- Bad: the storage key is required in middleware too.

### Confirmation

L2 measured files per route with and without grouping and ran both loaders with a failing then succeeding fetch and two concurrent imports ([note](../spikes/2026-10-28-l2.md)). S1.1 verified `eval`, `s.js` and hashing on Bunny ([note](../spikes/2026-10-28-s1-1.md)). S1 step 3 measures the part transport, which is then marked accepted or switched here. In the server-parts milestone, `/code` (Shiki `<Code>`) renders in both script types within the budget, a visitor requesting a part gets 404, a tampered part answers 500, and the build fails when a directly imported target exceeds 8 parts.
