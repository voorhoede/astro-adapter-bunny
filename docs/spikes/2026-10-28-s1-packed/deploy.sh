#!/bin/bash
# usage: STATE=<private dir> deploy.sh <variant> <built script> <marker>
# Publishes a built script to the variant's script and waits until its linked pull zone answers with the marker.
cd "$(dirname "$0")"
: "${STATE:?}" "${BUNNY_API_KEY:?}"
export BUNNYNET_API_KEY=$BUNNY_API_KEY
id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["Id"])' "$STATE/script-$1.json")
host=$(./api.sh GET "/compute/script/$id" | python3 -c 'import json,sys
d=json.load(sys.stdin); print(d["LinkedPullZones"][0]["DefaultHostname"])')
${BUNNY_CLI:-bunny} scripts deploy "$2" "$id" < /dev/null 2>&1 | grep -iE "error|fail" | head -2
for i in $(seq 1 30); do
  sleep 5
  if curl -s --max-time 20 -H 'x-spike-wait: 1' "$host/?w=$RANDOM$i" | grep -q "$3-$1"; then echo "$1 live"; exit 0; fi
done
echo "$1 not live after 150 s"; exit 1
