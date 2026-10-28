#!/bin/bash
# usage: URL=<pull zone url> SECRET=<header value> edge-rule.sh <path>; step 3b
# The zone has a BlockRequest edge rule: path matches */_bunny/server/* and x-aab-secret is not SECRET.
req() { curl -s -o /dev/null -D "$tmp" -w "%{http_code} bytes=%{size_download}" "$URL$1" "${@:2}"; echo " cdn-cache=$(grep -i '^cdn-cache:' "$tmp" | cut -d' ' -f2 | tr -d '\r') server=$(grep -i '^server:' "$tmp" | cut -d' ' -f2 | tr -d '\r')"; }
tmp=$(mktemp)
echo -n "1 no header:     "; req "$1"
echo -n "2 with header:   "; req "$1" -H "x-aab-secret: $SECRET"
echo -n "3 with header:   "; req "$1" -H "x-aab-secret: $SECRET"
for n in 4 5 6; do echo -n "$n no header:     "; req "$1"; done
echo -n "7 wrong header:  "; req "$1" -H 'x-aab-secret: wrong'
echo -n "8 other path, no header: "; req /t/a.css
