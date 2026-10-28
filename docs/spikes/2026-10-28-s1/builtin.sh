#!/bin/bash
# usage: SCRIPT_ID=<id> URL=<pull zone url> builtin.sh <specifier>; step 2, one static import per deploy
cd "$(dirname "$0")"; out=${OUT:-$(mktemp -d)}
marker="builtin-$RANDOM-$(date +%s)"
cat > "$out/builtin.js" <<JS
import * as probe from '$1';
Bunny.v1.serve(() => Response.json({ marker: '$marker', specifier: '$1', exports: Object.keys(probe).slice(0, 8), count: Object.keys(probe).length }, { headers: { 'cache-control': 'private, no-store' } }));
JS
echo "== $1"
./deploy.sh "$out/builtin.js" "$marker" || true
for n in 1 2 3; do
  curl -s -o /dev/null --max-time 30 -w "  req$n status=%{http_code} bytes=%{size_download} ttfb=%{time_starttransfer}s\n" "$URL/?r=$RANDOM$n"
done
curl -s --max-time 30 "$URL/?r=$RANDOM" | head -c 400; echo
