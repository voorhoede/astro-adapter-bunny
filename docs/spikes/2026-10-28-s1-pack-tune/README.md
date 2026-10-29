# Scripts for the S1 pack tune spike

Run from this directory, with `BUNNY_API_KEY` in the environment and `STATE` set to a private directory.

1. `node build.mjs <parts dir> <server dir> <s.js path> <out dir> <route part>,...` writes one script per variant.
2. `deno run -A local.mjs <out dir>/<variant>.js 'route=/code'` renders a variant locally.
3. `PREFIX=<prefix> ./setup.sh <variant>...` creates one standalone script with a linked pull zone per variant.
4. `BUNNY_CLI=<bunny cli> ./deploy.sh <variant> <out dir>/<variant>.js <marker>` publishes a build and waits for it.
5. Write `<variant> <hostname>` lines to a private hosts file, then
   `HOSTS=<file> CELLS='one:/code packed:/ ...' ROUNDS=<n> ./run.sh >> results.jsonl`.
6. `POPS=US:NY,DE:DE+BE,SG:SG node summarize.mjs results.jsonl`.
7. `PREFIX=<prefix> ./teardown.sh`, then `PREFIX=<prefix> LIST_ONLY=1 ./teardown.sh` to confirm nothing is left.

`probe.js` is a standalone script that reports `Function.prototype.toString()` for functions holding comments.
