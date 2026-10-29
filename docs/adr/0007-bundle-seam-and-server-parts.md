---
status: accepted (one packed script, Rollup and SystemJS `s.js`, the loader hook, the Shiki wasm rewrite, minify, the builtin and script size checks, CommonJS `require` of builtins); open (what makes bunny.net refuse a script between 8.4 and 9.3 MB)
date: 2026-10-28, updated 2026-10-29
---

# Server code in one packed script, loaded by SystemJS behind our own module

## Context and problem statement

Bunny takes one script file. `import()` fails in a Bunny isolate in every form: a `data:`, `blob:`, `https:` and relative specifier (S1.1, measured). Indirect `(0, eval)` and `new Function` both work there (S1.1). Startup grows with the script: a 7.3 MB script of generated code answered cold requests in 1.2 to 1.3 s and a 9.4 MB one never answered (S1 step 2, measured). The L2 test app (Astro 7, one Shiki `<Code>` block) is 11.6 MB of server code in 314 `System.register` parts, so as one module it never starts (transport spike, measured), while `/code` needs about 1.8 MB of it. The reference site's bundle is 2.74 MB only because Shiki is aliased out.

## Considered options

For how server code reaches the isolate:

- **One module of plain code.** Shiki-sized apps do not start.
- **Parts in storage, fetched at runtime.** Measured on bunny.net and rejected, see below.
- **Every lazy part packed into the script as data, unpacked on first import.** Startup tracks parse work, not script bytes: at equal size, the packed script's startup gap was 2.9 to 4.6 times smaller than generated functions' (S1 packed, measured).

For the module runtime:

1. **SystemJS behind our own module.** A specified loader: `s.js` is 7,976 bytes minified (`systemjs@6.15.1`, `dist/s.min.js`). Without a `document`, it resolves through hooks we supply and evaluates with indirect `eval`.
2. **Our own `System.register` runtime.** We would own live bindings, cycles and top-level await that SystemJS already implements.
3. **webpack or rspack with their own chunk loader.** A second bundler next to Vite. Heavy for one feature.

### Considered and rejected for the transport

- **Cache API, filled from storage on a miss.** Entries are per PoP, not per region, so every PoP pays its own miss, and a miss reads the storage main region: 0.6 to 3.7 s per 200 kB part from North America, 1.2 s from Singapore. A cold split request took 2 to 3.9 s outside Europe against 0.12 to 0.21 s for one module (S1 step 3a and 3c).
- **Storage API alone.** Main region only: one cold `/code` render took 3.5 s from New York and 6.4 s from Singapore (transport spike, variant B).
- **Our own pull zone with a secret header and an edge rule.** With every part a CDN hit it was 113 ms slower than one module of the route's closure in New York and 42 ms slower in Frankfurt; on a CDN miss 133 to 1,006 ms slower. Replicas lagged: some files were still read from the main region hours after upload (transport spike). It also needed an edge rule, a shared secret and a deploy tool change.
- **Splitting at fetch level at all.** The loader discovers the next import only after evaluating a part, so `/code` fetched in five sequential rounds, costing about 100 to 250 ms even on hits (transport spike).
- **Packed data in a comment, read with `toString()`.** bunny.net reprints the script and drops every comment form before evaluation, so the data never reaches the runtime (S1 pack tune).

## Decision outcome (accepted)

One script file holds all server code, and nothing is fetched at runtime for code. SystemJS `s.js` (option 1) is enough: with nothing fetched, a failed load is deterministic, so retrying through `System.delete` (the reason `system.js` was chosen before) gains nothing.

- **Build.** `build/bundle` runs Rolldown to ES modules, then Rollup to `System.register`, because Rolldown 1.2.15 has no `system` format and Rollup 4.66.0 has (both verified from their type definitions). Rollup chunking is its default: one chunk per `import()` target plus shared chunks. Merging below 32 kB is dropped in M3, since it only saved fetches and nothing is fetched now; M3 checks on `/code` that this costs nothing. Rollup, Rolldown (for its minifier) and `systemjs` are package dependencies. CI installs with `npm ci --ignore-scripts`.
- **What `dist/index.js` holds.** `s.js`, the eager chunks as code, and every lazy chunk brotli-compressed (quality 11) and base64-encoded in a table of string literals.
- **How a chunk loads.** On its first import, the loader hook decodes it with `Uint8Array.fromBase64`, decompresses it with `DecompressionStream('brotli')` and evaluates it with indirect `eval`. Nothing is unpacked at import. A warm request never unpacks: the loader keeps the evaluated module (S1 packed).
- **Shiki's wasm.** The build extracts Shiki's inlined base64 WebAssembly from its chunk and packs it as bytes, so Shiki no longer decodes 622 kB of base64 on every cold request. When the pattern is missing, the build leaves the chunk as it is.
- **Manifest.** `entryModules` entries that point at server files are stripped from Astro's server manifest.
- **Minify.** Every chunk is minified with Rolldown's own minifier (`minify` from `rolldown/utils`, oxc inside), with `keepNames` and `legalComments: 'inline'`. Legal comments survive only inside packed string data; bunny.net drops comments in the script's own source. No option turns minification off for now.
- **Source map.** Written next to the script as `dist/index.js.map`, outside `dist/client`, so it is not deployed.
- **CommonJS `require`.** Rolldown turns a CommonJS dependency's `require` of a builtin into `createRequire(import.meta.url)`, which throws under the loader, since a packed chunk has no file URL. `build/bundle` replaces it with the script's own `require`, which only knows the builtins the script imports statically: every `__require("name")` with a literal name is checked at build like an `import`, and a computed name that is not a builtin throws at runtime. Without this, one such dependency (postcss, through `sanitize-html`) made every route answer 500, because the runtime chunk is shared (M3 bloat spike). `node:fs`, `node:url` and `node:path` from postcss rendered on bunny.net (M3, one live check).
- **Builtins.** `build/bundle` refuses `node:child_process`, `node:vm`, `node:worker_threads`, `node:constants` and `node:path/win32`: each made the script answer 400 on every request while the publish was accepted (S1 step 2, measured).
- **Script size.** Checked on the whole script: warn above 4 MB, fail above 7 MB (S1 step 2, M3 bloat spike). At 1 MB the warning fired on every realistic site; at 4.35 MB a cold `/` still took 273 to 417 ms. A packed script carries about 3.7 times more code per MB than plain code (S1 packed, derived), so 7 MB is expected near 25 MB of source; not measured.
- **Data stays in string literals.** bunny.net reprints the script and drops every comment, `//# sourceURL` and license comments included (S1 pack tune).
- **`/_bunny/` stays reserved** in `routing` (ADR 0002). No file lives there any more; keeping it costs nothing and keeps the namespace for the adapter.

Measured on bunny.net with the L2 app (S1 pack tune variant 6, S1 minify v6r):

- Cold `/code` medians of 195 / 311 / 275 ms (New York / Frankfurt / Singapore) against 249 / 408 / 343 ms for one module of only the `/code` closure, so the packed script beat it in all three regions, although it carries the whole app (2.3 MB of script for 11.6 MB of code).
- Cold `/` at about 104 to 181 ms (medians).
- Minify gained about 11 ms on `/` (pooled, p 0.002), nearly all in startup; on `/code` the gain is not resolved at that sample size (S1 minify).
- `Uint8Array.fromBase64`, `DecompressionStream` with gzip and brotli, and `node:zlib` exist on bunny.net. ICU is already set up in a fresh isolate (S1 pack tune).

### Measured in M3

From the M3 bloat spike ([note](../spikes/2026-10-29-m3-bloat.md)), one heavy app of 437 on-demand routes built at growing sizes:

- **Where a packed script stops.** Scripts up to 8.35 MB (8,348,612 bytes) started and answered. At 8.68 and 9.02 MB the publish failed with an API 500, and from 9.56 MB on the publish was accepted but every request got an immediate 400. A trivial script padded with random base64 showed the same window, while repeated characters at 8.7 MB published, so the refusal depends on content, not only on size. The limit is the platform, not startup time.
- **The fail threshold stays at 7 MB.** It keeps about 1.3 MB below the largest script that started, and the refusal near 8.4 MB depends on content, so a higher threshold would have no margin.
- **A heavy site.** 18.9 to 36.2 MB of server code packed into 4.35 to 8.35 MB of script, about 4.1 to 4.35 times smaller, against the 3.7 assumed above. Every route gave the same HTML as Node. Cold `/` took 273 to 417 ms at 4.35 MB and 376 to 505 ms at 8.35 MB (New York, Frankfurt, Singapore medians, 5 to 12 cold samples per cell), about 19 to 56 ms per MB.
- **Subrequests.** Up to 3,000 sequential and 1,000 parallel fetches in one request all answered 200. No guard is added.
- **Memory.** Locally, 51 to 162 MB of heap after visiting every route, about 11 MB per MB of script. Not measured on bunny.net.
- **The 32 kB merge.** On the test app, merging cuts 318 chunks to 312, and cold `/code` took 68.8 ms unmerged against 68.4 ms merged (median of 30 cold Deno processes each, local), so dropping it costs nothing measurable.

### Security (accepted)

- **Server code is never publicly reachable.** A mistake can inline a secret into server code, so server code must not be public. It lives only in the script; no part is in storage or the CDN cache.
- **Tampering.** Code and data ship in the release itself, so there is no fetched input to check. The per-part hash check is gone with the fetch.
- **Code evaluation.** Indirect `eval` runs only string literals the build wrote into the same script. The reference site's maintainers review this section before migrating.

### Consequences

- Good: Shiki-sized dependencies work without aliasing; one code path for every site.
- Good: no network on the code path, so no miss tail per region, no retry, no replica lag and no deploy tool change.
- Good: we do not own a module runtime. `build/bundle` and the packed loader are the only modules that know chunks are packed.
- Bad: a route pays unpacking of its lazy chunks on every cold request: 15 to 21 ms for `/code` (S1 pack tune variant 6).
- Bad: the whole app counts against the script limit, so the ceiling is a site of roughly 25 MB of server code (expected), where parts in storage had none.
- Bad: two dependencies, one with a native binary. SystemJS has had no release since 6.15.1 on 2024-04-27, about 30 months.
- Bad: the wasm rewrite matches Shiki's current output; when Shiki changes it, the build silently stops rewriting and Shiki decodes its wasm per cold request again.
- Bad: memory. The isolate keeps the packed strings and every unpacked module for its lifetime; not measured.

### Confirmation

S1.1 verified `eval` and `s.js` on bunny.net ([note](../spikes/2026-10-28-s1-1.md)). S1 step 2 measured builtins and the size limit ([note](../spikes/2026-10-28-s1-2.md)). S1 steps 3a to 3c ([note](../spikes/2026-10-28-s1.md)) and the transport spike ([note](../spikes/2026-10-28-s1-transport.md)) measured the transports rejected above. S1 packed ([note](../spikes/2026-10-28-s1-packed.md)), S1 pack tune ([note](../spikes/2026-10-28-s1-pack-tune.md)) and S1 minify ([note](../spikes/2026-10-28-s1-minify.md)) measured the packed script. In M3, `/code` renders from the packed script in both script types with the same HTML as unpacked, importing the script loads no chunk, the build fails on a refused builtin and on a script above 7 MB, and a build without Shiki's pattern still renders.
