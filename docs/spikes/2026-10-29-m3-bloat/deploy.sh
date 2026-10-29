#!/bin/bash
# usage: STATE=<private dir> deploy.sh <variant> <built script> [marker prefix]
# Publishes a built script to the variant's script and waits until its linked pull zone answers /marker with a body
# starting with the marker prefix (default bloat-), or 240 s pass.
cd "$(dirname "$0")"
: "${STATE:?}" "${BUNNY_API_KEY:?}"
export BUNNYNET_API_KEY=$BUNNY_API_KEY
id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["Id"])' "$STATE/script-$1.json")
host=$(./api.sh GET "/compute/script/$id" | python3 -c 'import json,sys
d=json.load(sys.stdin); print(d["LinkedPullZones"][0]["DefaultHostname"].split("://")[-1])')
echo "$1 $host" >> "$STATE/hosts"
start=$(date +%s)
${BUNNY_CLI:-bunny} scripts deploy "$2" "$id" < /dev/null > "$STATE/deploy-$1.log" 2>&1
echo "$1 deploy exit $? after $(( $(date +%s) - start )) s: $(grep -iE 'error|fail|success|publish|deploy' "$STATE/deploy-$1.log" | head -3 | tr '\n' ' ')"
for i in $(seq 1 48); do
  sleep 5
  body=$(curl -s --max-time 30 "https://$host/marker?w=$RANDOM$i")
  case "$body" in "${3:-bloat-}"*) echo "$1 live after $(( $(date +%s) - start )) s: $body"; exit 0;; esac
done
echo "$1 not live after 240 s, last body: $(echo "$body" | head -c 120)"; exit 1
