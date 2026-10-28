#!/bin/bash
# usage: URL=<standalone pull zone url> request-facts.sh; step 5 against probe-standalone.js
seen() { python3 -c 'import json,sys; d=json.load(sys.stdin); h=d["headers"]; print("  url", d["url"], "| method", d["method"], "| range", h.get("range"), "| if-none-match", h.get("if-none-match"), "| if-modified-since", h.get("if-modified-since"), "| cdn-requestmethod", h.get("cdn-requestmethod"))'; }
echo "Range"; curl -s "$URL/facts?r=$RANDOM" -H 'range: bytes=0-9' | seen
echo "If-None-Match"; curl -s "$URL/facts?r=$RANDOM" -H 'if-none-match: "abc"' | seen
echo "If-Modified-Since"; curl -s "$URL/facts?r=$RANDOM" -H 'if-modified-since: Wed, 21 Oct 2015 07:28:00 GMT' | seen
echo "POST"; curl -s -X POST "$URL/facts?r=$RANDOM" --data 'x=1' | seen
q=$RANDOM
echo "HEAD"; curl -s -I "$URL/facts?h=$q" | grep -iE '^(HTTP|content-length|cdn-cache|x-seen-method)'
echo "Range on a cacheable response, twice"; for n in 1 2; do curl -s -D - -o /dev/null "$URL/plain?g=$q" -H 'range: bytes=0-9' | grep -iE '^(HTTP|content-range|cdn-cache)' | tr '\r\n' '  '; echo; done
echo "Stream: 2 s between chunks"
for n in 1 2 3; do curl -s -N -o /dev/null -w "  ttfb=%{time_starttransfer}s total=%{time_total}s\n" "$URL/stream?s=$RANDOM$n"; done
curl -s -N "$URL/stream?s=$RANDOM" | while read -r line; do echo "  $(python3 -c 'import time; print(int(time.time()*1000))') $line"; done
