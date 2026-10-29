#!/bin/bash
# usage: build-size.sh <generated MB>...
# Per size: generates the app, builds it through the adapter (recording whether the adapter accepted it), packs
# dist/server with pack.mjs into out/s<MB>.js, then checks every route under Deno against Node and records memory.
cd "$(dirname "$0")"
mkdir -p out
for mb in "$@"; do
  (cd app && GEN_MB=$mb node gen.mjs && npx astro build > ../out/build-$mb.log 2>&1)
  echo "{\"mb\":$mb,\"adapterBuild\":$? ,\"adapterMessage\":$(grep -E 'MB|rror' out/build-$mb.log | grep -v '^\s*at ' | tail -1 | node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8").trim()))')}" > out/adapter-$mb.json
  node pack.mjs app out/s$mb.js 2>/dev/null > out/pack-$mb.json
  node routes.mjs app > out/routes.txt
  node node-ref.mjs app out/routes.txt > out/node-$mb.json
  deno run --allow-read --allow-env --v8-flags=--expose-gc local.mjs out/s$mb.js out/routes.txt > out/local-$mb.json 2> out/local-$mb.err
  echo "$mb $(cat out/adapter-$mb.json) $(cat out/pack-$mb.json) $(node compare.mjs out/local-$mb.json out/node-$mb.json)"
done
