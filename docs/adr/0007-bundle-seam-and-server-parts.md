---
status: accepted (always split, Rollup and SystemJS, grouping, parts never public, location under `_bunny/server/`, own hash check); proposed (how parts reach the script, eager size thresholds, the per-route budget value)
date: 2026-10-28
---

# Server code always in parts, loaded by SystemJS behind our own module

## Context and problem statement

Bunny takes one script file. Startup goes past 500 ms at about 2 MB of real code, and a 9.5 MB script failed after its first request (measured); other sources saw failures from about 7.5 MB, and the prototype saw specific builtins fail at any size, so the limit looks like startup work rather than bytes **[guess, in two sources]**. The reference site's bundle is 2.74 MB only because Shiki is aliased out. `import()` failed in a Bunny isolate in every form (a recorded decision of the prototype, about a month old). Evaluating fetched code with `new Function` worked up to at least 18 MB (measured in the prototype). The prototype split a 10.7 MB Astro bundle at its own `import()` boundaries into a 467 KB eager part and cut cold medians by about 30%. Without grouping, one request there could need more than the 50 subrequests a request may make (448 modules, measured count).

## Considered options

For when to split:

- **One module, permanently.** Shiki-sized dependencies stay out of reach.
- **Split above a size threshold.** Small sites keep the simple path, but there are two code paths and the threshold is a guess.
- **Always split, no threshold, no option.**

For the module runtime that loads parts:

1. **SystemJS `s.js` behind our own module.** A specified loader of 7,976 bytes minified (`systemjs@6.15.1`, `dist/s.min.js`). Without a `document`, it fetches through a `shouldFetch` and `fetch` hook we supply and evaluates with indirect `eval`. It loaded a Rollup-split chain of `System.register` parts in local Deno 2.9.5 (verified locally, not on Bunny).
2. **Our own `System.register` runtime.** We would own live bindings, cycles and top-level await that SystemJS already implements.
3. **webpack or rspack with their own chunk loader.** A second bundler next to Vite. Heavy for one feature.

## Decision outcome (accepted)

Always split in v1, with SystemJS `s.js` (option 1).

- **Build.** `build/bundle` runs Rolldown to ES modules, then Rollup to `System.register`, because Rolldown 1.2.15 has no `system` format and Rollup 4.66.0 has (both verified from their type definitions). Rollup and `systemjs` become package dependencies; `s.js` is bundled into the eager script. CI installs with `npm ci --ignore-scripts`, so a dependency that needs an install script fails the build and runtime tests.
- **Grouping is mandatory.** Rollup chunking, one chunk per `import()` target plus shared chunks, small chunks merged, and a budget of files reachable per route, fixed in L2 before the milestone and enforced at build. Proposed start value about 10 **[guess, from the prototype]**. A packer that groups parts into one fetch only if Rollup's chunking cannot meet the budget.
- **Eager script size (proposed).** Fail above 7 MB raw, under the lowest measured failure; warn above 1 MB, since 2 MB of code already cost 460 to 520 ms cold. Parts have no script limit but count against 128 MB memory and parse time (about 30 ms per MB, measured in the prototype).
- **Where parts live.** In the assets dir under `_bunny/server/`, with the content hash in the name, so they upload and roll back with the release without a deploy tool change. Not a dotfile (one deploy tool skips those), and sorts after `_astro`. The manifest names the prefix in `assets.reserved` (ADR 0004).
- **How they reach the script (proposed).** Behind `server-parts` only, so the choice stays inside one module:
  - Primary: bunny.net's regional Cache API. On a miss, fetch the part from the Storage API and store it in the Cache API. Nothing is publicly addressable.
  - Fallback on the same path: the Storage API alone, main region only (about 420 ms against about 85 ms from a replica, from New York, measured).
  - Alternative if the Cache API falls short: fetch through our own pull zone with a secret header, plus an edge rule rejecting requests without it. Costs a deploy tool change (the edge rule, a shared secret and its rotation) and recognizing the self-request in `onOriginRequest` before `routing`. Standalone still reads from the Storage API on a miss.
  - Decision rule: keep the Cache API if S1 shows it fast enough and parts stay cached long enough. Otherwise switch to the alternative, but only if S1 step 3b shows an edge rule blocks a request without the header even when the object is already in the CDN cache.
- **How they load.** `server-parts` owns `s.js`, its fetch hook and an import map with a SHA-256 per part. Nothing is loaded at import; the first request that needs a page loads its parts. A failed fetch is not remembered, so the next import retries. Concurrent first imports of one part share one fetch.

### Security (accepted)

- **Parts are never publicly reachable.** A mistake can inline a secret into server code, so server code must not be public. `routing` answers not found for `/_bunny/` in both types (ADR 0002), so a visitor's cache miss never reaches the file. The proposed primary transport keeps parts out of the public CDN cache entirely; the alternative relies on the edge rule holding on cache hits, which S1 must show first. Prerendered error pages use the same read path.
- **Tampering.** The release embeds a SHA-256 per part, and the hook checks it before evaluating, using `crypto.subtle` captured at startup. The prototype verified that captured references survive app code patching globals; it never hashed parts, so the cost is unmeasured (L2 step 4, S1 step 1). We do not rely on `integrity` in Bunny's `fetch`. A mismatch fails closed with a `private, no-store` 500.
- **Code evaluation.** Parts come from our own storage (no third-party processor), are immutable per deploy (a rollback takes them along), and carry a hash. The reference site's maintainers review this section before migrating.

### Consequences

- Good: Shiki-sized dependencies work without aliasing; one code path for every site.
- Good: we do not own a module runtime. `build/bundle` and `server-parts` are the only modules that know parts exist.
- Bad: the least verified part of the design is on the path to the first release. S1 asks first whether indirect `eval` and `s.js` run on Bunny; if not, the fallback is a fork of `s.js` evaluating with `new Function`.
- Bad: two dependencies, one with a native binary. SystemJS has had no release since 6.15.1 on 2024-04-27, about 30 months.
- Bad: every first use of a part per isolate costs a subrequest, and a Cache API miss costs a Storage API fetch at the main region (about 420 ms from New York, measured). Cache API latency and eviction on Bunny are unmeasured (S1 step 3a). Whether a small app split is slower than one module is unmeasured (S1 step 3c).
- Bad: the storage key is required in middleware too.

### Confirmation

L2 measures files per route with and without grouping, and runs `s.js` with a failing then succeeding fetch and two concurrent imports. S1 ends with a note on `eval`, `s.js`, hashing and the part transport on Bunny, and the transport is then marked accepted or switched here. In the server-parts milestone, `/code` (Shiki `<Code>`) renders in both script types within the budget, a visitor requesting a part gets 404, a tampered part answers 500, and the build fails when a route exceeds the budget.
