# Scripts for the M3 bloat spike

Run from this directory, with `BUNNY_API_KEY` and `GLOBALPING_TOKEN` in the environment and `STATE` set to a private directory (mode 700). `api.sh`, `setup.sh`, `teardown.sh` and `run.sh` are the S1 minify scripts; `run.sh` now takes a path per cell. `gp.mjs` also records the PoP from the `server` header and the app's `x-spike-*` headers. `deploy.sh` waits for `/marker` instead of a JSON marker. `summarize.mjs` is rewritten for header-based cold detection.

- `app/` is the spike Astro app (`output: 'server'`, the adapter from `src/build/integration.ts` as a standalone script). `app/gen.mjs` writes its generated half: 300 on-demand pages, one module of generated code per page, 120 markdown and MDX posts and locale data. `GEN_MB` sets the generated code; `SANITIZER=sanitize-html` swaps the `/md` sanitizer back to the one that breaks under the packed loader.
- `src/middleware.ts` in the app adds `x-spike-isolate` and `x-spike-count` to every response; count 1 is the isolate's first request.
- `pack.mjs` runs the adapter's own `bundle()` on `app/dist/server`, without the 7 MB check the integration applies.
- `local.mjs` (Deno) loads a script with a stub `Bunny.v1.serve`, requests every route and records `Deno.memoryUsage()`. `node-ref.mjs` renders the same routes from `dist/server/entry.mjs` under Node, `compare.mjs` compares the two.
- `pad.mjs` writes a trivial script padded with one string literal, to test publishing by size alone.
- `target.js` is the subrequest target, a script that answers `ok`.

1. `cd app && npm install`.
2. `./build-size.sh 0 2.5 10 14 16 17.5 19 21.5 29 36` builds, packs and checks every size into `out/` (build log, `adapter-<MB>.json`, `pack-<MB>.json`, `local-<MB>.json`, `node-<MB>.json`, `s<MB>.js`).
3. `PREFIX=aab-spike-bloat- ./setup.sh s0 s2p5 s10 s14 s17p5 s21p5 s29 s36 sub target`, then deploy `target.js` to `target` with `bunny scripts deploy`.
4. `./deploy.sh <variant> out/s<MB>.js bloat-<MB>-` per size; it appends `<variant> <hostname>` to `$STATE/hosts`.
5. `HOSTS=$STATE/hosts CELLS='s0:/ s0:/code/all ...' ROUNDS=10 ./run.sh >> out/results.jsonl`, then `POPS=US:NY,DE:DE+BE,SG:SG node summarize.mjs out/results.jsonl`.
6. Subrequests: `curl "https://<sub host>/fetches?n=1000&mode=seq&target=<target host>"` (`mode=par` for parallel).
7. `PREFIX=aab-spike-bloat- ./teardown.sh`, then `PREFIX=aab-spike-bloat- LIST_ONLY=1 ./teardown.sh` to confirm nothing is left.
