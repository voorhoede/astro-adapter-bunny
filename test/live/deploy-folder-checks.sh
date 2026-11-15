#!/bin/zsh
source ${0:A:h}/lib.sh
c() { if [ "$2" = "$3" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $1: got '$2', want '$3'"; fi; }
c "marker from folder" "$(curl -s -m 30 "$H/marker.txt?t=$RANDOM")" "from deploy $1"
c "folder blocked" "$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$H/deploys/$1/marker.txt")" "403"
c "astro url without folder" "$(curl -s -m 30 "$H/request.json?t=1" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["astroUrl"])' 2>/dev/null)" "$H/request.json?t=1"
c "spoofed header ignored without rule path" "$(curl -s -m 30 -o /dev/null -w '%{http_code}' -H "x-bunny-deploy: $1" "$H/products/42")" "200"
report "deploy folder"
