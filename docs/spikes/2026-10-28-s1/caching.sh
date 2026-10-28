#!/bin/bash
# usage: URL=<standalone pull zone url> caching.sh; step 7 against probe-standalone.js. Two requests per case: client A, then client B.
q=$RANDOM
one() { curl -s -D "$tmp" "$URL$1?q=$q" "${@:2}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("id", d["id"][:8], "cookie-seen", d["cookie"])' | tr '\n' ' '; grep -iE '^(cdn-cache|set-cookie|cache-control|vary):' "$tmp" | tr -d '\r' | tr '\n' ' '; echo; }
tmp=$(mktemp)
for path in /plain /cookie /vary /cdncc /cdncc-off; do
  echo "== $path"
  echo -n "  A: "; one $path -H 'cookie: user=a'
  echo -n "  B: "; one $path -H 'cookie: user=b'
  echo -n "  C, no cookie: "; one $path
done
