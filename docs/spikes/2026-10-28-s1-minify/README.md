# Scripts for the S1 minify spike

Run from this directory, with `BUNNY_API_KEY` and `GLOBALPING_TOKEN` in the environment and `STATE` set to a private directory. `setup.sh`, `deploy.sh`, `teardown.sh`, `api.sh`, `run.sh` and `local.mjs` are the S1 pack tune scripts unchanged; `gp.mjs` now waits out a Globalping 429 instead of stopping.

1. Install `oxc-minify` outside the repo (for example `npm install oxc-minify` in a scratch directory) for the `v6o` variant.
2. `OXC_MINIFY=<scratch dir>/node_modules/oxc-minify/index.js node build.mjs <parts dir> <server dir> <SystemJS s.min.js> <out dir>` writes `v5.js`, `v6r.js` and `v6o.js` and prints the deploy marker last.
3. `node sizes.mjs <out dir>/*.js` prints script, eager and packed sizes.
4. `deno run -A local.mjs <out dir>/v5.js 'route=/code'` renders a variant locally.
5. `PREFIX=<prefix> ./setup.sh v5 v6r v6o` creates one standalone script with a linked pull zone per variant.
6. `BUNNY_CLI=<bunny cli> ./deploy.sh <variant> <out dir>/<variant>.js <marker>` publishes a build and waits for it.
7. Write `<variant> <hostname>` lines (hostname without scheme) to a private hosts file, then
   `HOSTS=<file> CELLS='v5:/code v6r:/code v6o:/code v5:/ v6r:/ v6o:/' ROUNDS=<n> ./run.sh >> results.jsonl`.
8. `POPS=US:NY,DE:DE+BE,SG:SG BASE=v5 node summarize.mjs results.jsonl`.
9. `PREFIX=<prefix> ./teardown.sh`, then `PREFIX=<prefix> LIST_ONLY=1 ./teardown.sh` to confirm nothing is left.
