# S1 transport: split server code through our own pull zone, against one module, on bunny.net

Run on 2026-10-28 against throwaway resources, all deleted afterwards. The question: for a real Astro route, does splitting server code and fetching the parts through our own pull zone (ADR 0007's alternative transport) beat putting the code the route needs into one script? The route is `/code` of a small Astro 7 server app (one Shiki `<Code>` block), built by L2 into `System.register` parts with Rollup (`experimentalMinChunkSize` 32 kB, 314 parts, 11.6 MB in all). Runtime as in S1 (Deno on Bunny, standalone scripts). Multi-region numbers come from anonymous Globalping HTTP probes; local checks are from the Netherlands, served by the DE PoP.

The sources are in [`2026-10-28-s1-transport/`](2026-10-28-s1-transport/).

## Setup

- `trace.mjs` renders the route locally under SystemJS (`dist/system.min.js` from `systemjs` 6.15.1) and lists the parts it loads. `/code` needs `entry.js` (a 243-byte stub) and the 674 kB eager part, then the 322 kB page part, then the 608 kB Shiki wasm part, then the 187 kB TypeScript grammar and the 13 kB theme: 1.8 MB in six files.
- `build.mjs` writes three standalone scripts, each rendering the route with `module.default.fetch(request)` and answering JSON timings instead of the HTML:
  - `split.js` (15 kB): SystemJS plus a fetch hook. Parts load on the first request, not at startup.
  - `one.js` (1.8 MB): SystemJS plus the six parts the route needs, each wrapped in a function and registered by name, so nothing is fetched.
  - `all.js`: the same with more parts added up to a size cap, for the size sweep.
- `setup.sh` creates the resources (I ran its steps by hand; the script is the cleaned-up record, not run as a whole):
  - A storage zone in DE with NY and SG replicas, the six parts uploaded under `_bunny/server/r1/`.
  - A pull zone on that storage zone, with query strings in the cache key (so `?bust=` forces a miss) and the S1 step 3b edge rule: block `*/_bunny/server/*` unless `x-aab-secret` carries the secret. Checked with S1's `edge-rule.sh`: 403 without or with a wrong header, also on a cached object; 200 with it.
  - Script A: `split.js`, parts through that pull zone with the secret header.
  - Script B: `split.js`, parts from the Storage API (main region DE) with the read-only password.
  - Script C: `one.js`, later `all.js` at several sizes.
- `gp.mjs` runs Globalping rounds against a script, one probe per location per round, each round with a fresh query string. `teardown.sh` deletes everything with the prefix and lists what is left.

Cold means the response came from an isolate's first request (the script reports a per-isolate count). Nearly every Globalping request landed on a new isolate; warm rows are the few that did not. Time to first byte includes the render, since the script answers after rendering. "Startup gap" is time to first byte minus the time the script spent inside its handler: connection, isolate start and script evaluation.

## Results, cold, `/code`

Time to first byte from Globalping, median and range in ms. Probes asked for "New York" twice landed on the TX PoP; those are kept and marked.

| Variant | New York | Frankfurt | Singapore |
| --- | --- | --- | --- |
| A, pull zone, all parts CDN hits (5 each) | 346 (224 to 351) | 398 (332 to 1,508) | 376 (361 to 464) |
| A, pull zone, all parts CDN misses, forced with `?bust` (7, 8, 8) | 605 (484 to 964) | 489 (395 to 2,982) | 1,419 (1,308 to 1,586) |
| A, first request per PoP without bust (0, 2, 2) | | 402 (DE, parts already cached by local checks), 561 (FR, misses) | 1,318, 1,416 |
| B, Storage API in DE (6, one TX; 6; 4) | 3,497 (3,339 to 4,917) | 426 (359 to 1,199) | 6,377 (6,342 to 6,431) |
| C, one module of 1.8 MB (5 each) | 233 (220 to 431) | 356 (309 to 383) | 413 (378 to 453) |

Where the time goes, medians in ms:

| Variant | Handler time NY / FRA / SG | Startup gap NY / FRA / SG |
| --- | --- | --- |
| A, hits | 318 / 368 / 349 | 26 / 30 / 26 |
| A, misses | 588 / 449 / 1,348 | 22 / 27 / 63 |
| B | 3,466 / 359 / 6,320 | 28 / 30 / 64 |
| C | 150 / 211 / 263 | 91 / 120 / 150 |

Until late in the run, a request without `?route=` rendered `/` on A and B and failed on the missing index part. Some arrived from outside the measurements; they could have put the eager part in a PoP's cache before the "first request per PoP" row, but not into the forced-miss rows (unique `?bust`) or the cold rows (an isolate they touched would report a count above 1).

One Frankfurt miss took 2,982 ms because the eager part alone took 2.6 s; the 1,508 ms hit had a slow connection (the handler took 401 ms).

Warm, same isolate (18 requests across all variants and regions): 9 to 34 ms to first byte, 2 to 6 ms in the handler.

### What the part fetches look like

- The loader fetches in five sequential rounds: `entry.js`, the eager part, the page part, the wasm part, then the grammar and theme together. Each round waits for the previous part to be evaluated, because the next import is only discovered then.
- On a CDN hit each part took 5 to 50 ms from fetch to text, in every region.
- On a forced miss the replicated parts took 12 to 40 ms from NY and SG, as in S1. The exception is below.

### Two parts were not read from the replica

On every Singapore miss, the TypeScript grammar took 950 to 1,200 ms and the theme 330 to 400 ms, while the larger eager and wasm parts took 20 to 40 ms. The `?probe` mode of `split.js` fetches parts without evaluating them and returns the pull zone's `cdn-storageserver` header:

| Part | From NY, miss | From SG, miss |
| --- | --- | --- |
| eager, page, wasm | `NY-*`, 25 to 243 ms | `SG-*`, 25 to 43 ms |
| TypeScript grammar | `DE-*`, 180 to 387 ms | `DE-*`, 958 to 1,200 ms |
| theme | `DE-*`, 162 to 171 ms | `DE-*`, 337 ms |

So the CDN read those two files from the main region, about an hour after the upload, while the other four files of the same upload came from the replica. RECHECK_PLACEHOLDER

That gap is most of A's Singapore miss: without it the miss would be expected near 400 to 500 ms (the other parts' miss times plus the hit-path evaluation), not measured.

## Results, one module by size

`all.js` with the six `/code` parts first and other parts of the same app after them, unused by the route. Cold time to first byte from Globalping, median and range in ms; the startup gap in brackets.

| Script size | New York | Frankfurt | Singapore |
| --- | --- | --- | --- |
| 1.8 MB (C above) | 233 [91] | 356 [120] | 413 [150] |
| 3.5 MB (3 to 4 each) | 262 (256 to 289) [110] | 425 (372 to 441) [197] | 445 (409 to 453) [195] |
| 4.7 MB (4 to 5 each) | 292 (269 to 516) [135] | 436 (420 to 495) [192] | 478 (420 to 513) [225] |
| 6.1 MB (1 each, and 3 local) | 584 at TX [338] | local 522 to 651 | 594 [332] |
| 7.0 MB (4 to 5 each) | 1,664 (1,215 to 2,083) [1,461] | 1,862 (1,755 to 1,948) [1,617] | 1,969 (1,901 to 2,102) [1,723] |
| 8.9 MB | never starts | never starts | never starts |
| 11.6 MB (the whole app, D) | never starts | never starts | never starts |

"Never starts": the publish is accepted, and every request answers 400 with an empty body, for the 2 minutes checked from DE and from NY and SG probes (11.6 MB) or from DE (8.9 MB). The same failure form as the broken builtins in S1 step 2.

The added parts are wrapped in functions that never run, so V8 only pre-parses them. A module whose code all runs at startup would cost more per MB; expected, not measured.

## What it decides

- **For `/code`, A does not beat C.** With every part a CDN hit, A was 113 ms slower than C in New York, 42 ms slower in Frankfurt and 37 ms faster in Singapore (medians). On a CDN miss A was 372, 133 and 1,006 ms slower. Splitting moves cost from startup (C's gap is 65 to 125 ms larger) into the handler (A spends 86 to 168 ms more there, fetching in five rounds and evaluating with `eval`), and the handler side is larger.
- **B is out.** The Storage API from outside DE took 3.5 s (New York) and 6.4 s (Singapore) for one cold render. It is not a fallback for anything on the request path outside Europe.
- **One module stops being an option between 6.1 and 7.0 MB in practice, and between 7.0 and 8.9 MB absolutely.** Up to 4.7 MB the startup gap grew by 15 to 26 ms per MB; at 6.1 MB it was about 330 ms; at 7.0 MB about 1.6 s; at 8.9 MB the script never started. ADR 0007's 7 MB fail threshold is right at the edge: 7.0 MB still started, but slowly. Warn at 1 MB looks too strict for this kind of code; about 5 MB is where cold cost starts to climb (measured with mostly unused code, see above).
- **So the transport question is narrower than ADR 0007 assumed.** The split only pays when the code a route needs does not fit one module, or when unused code makes the module slow to start. For a site this size (11.6 MB in all, 1.8 MB per route), one module per site does not fit, and one module per route is not something Bunny offers (one script per pull zone).
- **Transport for ADR 0007: the pull zone.** Its hits are fast in every region (5 to 50 ms per part), and its misses are fast where the replica actually has the file. The Cache API (S1 step 3a) and the Storage API (B) both cost seconds outside Europe on a miss. Two conditions come with it:
  - Replication is not a given. Two of six files were read from DE an hour after upload. The deploy has to check that the replicas serve each part before switching the release, or accept a main-region read on the first miss per PoP. How to check is open (the replica storage endpoints answered 401 to the zone's password).
  - Fewer fetch rounds matter more than smaller parts. Five sequential rounds cost about 100 to 250 ms on hits even when each part is fast. Prefetching the known closure of a route in one round (a per-route part list in the manifest, fetched concurrently) is expected to remove most of that; not measured.
- **Recommendation:** keep "always split" only with a size rule: emit one module when the server build is under a threshold (about 5 MB measured here), split above it, with parts through the pull zone and the route's parts fetched in one concurrent round. That reverses ADR 0007's "always split, no threshold" for small sites, which are faster as one module by this measurement.

## Not covered

- Prefetching a route's parts concurrently in one round, and the SHA-256 check per part (ADR 0007), both of which change A's handler time.
- Why two files were not replicated, how long replication takes, and whether a re-upload or the Storage API offers a way to check it.
- Middleware scripts, origin shield, and the pull zone's cache surviving longer than this run (about two hours).
- Other routes and other apps. One module was measured with mostly unused code; a route that runs more code at startup is expected to cost more per MB.
- More than 1 to 8 samples per cell. Globalping's anonymous hourly limit ended the run; the 6.1 MB row has one probe per region.
