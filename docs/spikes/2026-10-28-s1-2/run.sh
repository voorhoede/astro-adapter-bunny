#!/bin/bash
# usage: SCRIPT_ID=<id> URL=<pull zone url> run.sh <kind> <arg>; deploys one variant and measures it
cd "$(dirname "$0")"

marker=$(WASM_CHUNK="$WASM_CHUNK" node gen.mjs "$1" "$2" | cut -d' ' -f1)
bytes=$(wc -c < main.js | tr -d ' ')
deploy=$(bunny scripts deploy main.js "$SCRIPT_ID" < /dev/null 2>&1 | grep -iE "error|fail|live at" | head -2 | tr '\n' ' ')
live=""
for i in $(seq 1 24); do
  sleep 5
  body=$(curl -s --max-time 20 "$URL/?w=$RANDOM$i")
  if echo "$body" | grep -q "$marker"; then live=yes; break; fi
done
echo "== $1 $2 bytes=$bytes deploy=[$deploy] live=${live:-no}"
[ -n "$live" ] || { echo "last body: $(echo "$body" | head -c 200)"; }
echo "$body" | head -c 600; echo
for n in 1 2 3 4 5; do
  sleep 3
  curl -s -o /dev/null --max-time 30 -w "  req$n status=%{http_code} ttfb=%{time_starttransfer}s total=%{time_total}s\n" "$URL/?r=$RANDOM$n"
done
