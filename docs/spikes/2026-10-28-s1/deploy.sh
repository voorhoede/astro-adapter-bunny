#!/bin/bash
# usage: SCRIPT_ID=<id> URL=<pull zone url> deploy.sh <file> <marker>
# Uploads and publishes <file> through the API (BUNNY_API_KEY), then waits until $URL/ answers with <marker>.
file=$1; marker=$2
python3 -c 'import json,sys; print(json.dumps({"Code": open(sys.argv[1]).read()}))' "$file" \
  | curl -s -o /dev/null -w "upload=%{http_code} " -X POST "https://api.bunny.net/compute/script/$SCRIPT_ID/code" \
    -H "AccessKey: $BUNNY_API_KEY" -H 'content-type: application/json' --data-binary @-
curl -s -o /dev/null -w "publish=%{http_code}\n" -X POST "https://api.bunny.net/compute/script/$SCRIPT_ID/publish" \
  -H "AccessKey: $BUNNY_API_KEY" -H 'content-type: application/json' --data '{"Note":"spike"}'
for i in $(seq 1 30); do
  sleep 4
  body=$(curl -s --max-time 20 -H "x-spike-wait: 1" "$URL/?wait=$RANDOM$i")
  if echo "$body" | grep -q "$marker"; then echo "live after $((i * 4)) s"; exit 0; fi
done
echo "not live; last body: $(echo "$body" | head -c 200)"; exit 1
