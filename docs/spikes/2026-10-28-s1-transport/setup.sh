#!/bin/bash
# usage: PREFIX=<name prefix> STATE=<private dir> setup.sh
# Creates <prefix>parts (storage zone in DE with NY and SG replicas, and a storage-origin pull zone with query strings
# in the cache key and a BlockRequest edge rule on */_bunny/server/* without the secret header) and three standalone
# scripts <prefix>a, <prefix>b, <prefix>c with linked pull zones. A gets PART_ZONE and PART_SECRET, B gets
# STORAGE_BASE and STORAGE_KEY (read-only password). API responses, ids and the secret stay in STATE (mode 700).
set -e
cd "$(dirname "$0")"
: "${PREFIX:?}" "${STATE:?}" "${BUNNY_API_KEY:?}"
export BUNNYNET_API_KEY=$BUNNY_API_KEY
bunny=${BUNNY_CLI:-bunny}
mkdir -p "$STATE"; chmod 700 "$STATE"
json() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$@"; }

./api.sh POST /storagezone "{\"Name\":\"${PREFIX}parts\",\"Region\":\"DE\",\"ReplicationRegions\":[\"NY\",\"SG\"],\"ZoneTier\":0}" > "$STATE/storage.json"
storage_id=$(json "$STATE/storage.json" Id)
./api.sh POST /pullzone "{\"Name\":\"${PREFIX}parts\",\"OriginType\":2,\"StorageZoneId\":$storage_id}" > "$STATE/pz.json"
zone_id=$(json "$STATE/pz.json" Id)
./api.sh POST "/pullzone/$zone_id" '{"IgnoreQueryStrings":false}' > /dev/null
head -c 32 /dev/urandom | xxd -p -c 64 > "$STATE/secret"; chmod 600 "$STATE/secret"
python3 - "$(cat "$STATE/secret")" > "$STATE/rule.json" <<'PY'
import json, sys
print(json.dumps({"ActionType": 4, "TriggerMatchingType": 1, "Enabled": True, "Description": "block server parts", "Triggers": [
  {"Type": 0, "PatternMatches": ["*/_bunny/server/*"], "PatternMatchingType": 0},
  {"Type": 1, "Parameter1": "x-aab-secret", "PatternMatches": [sys.argv[1]], "PatternMatchingType": 2}]}))
PY
curl -s -o /dev/null -w "edge rule %{http_code}\n" -X POST "https://api.bunny.net/pullzone/$zone_id/edgerules/addOrUpdate" \
  -H "AccessKey: $BUNNY_API_KEY" -H 'content-type: application/json' --data @"$STATE/rule.json"

for v in a b c; do
  ./api.sh POST /compute/script "{\"Name\":\"${PREFIX}$v\",\"ScriptType\":1,\"CreateLinkedPullZone\":true,\"LinkedPullZoneName\":\"${PREFIX}$v\"}" > "$STATE/script-$v.json"
done
a=$(json "$STATE/script-a.json" Id); b=$(json "$STATE/script-b.json" Id)
host=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["Hostnames"][0]["Value"])' "$STATE/pz.json")
$bunny scripts env set PART_ZONE "$host" --id "$a" > /dev/null
$bunny scripts env set RELEASE r1 --id "$a" > /dev/null
$bunny scripts env set PART_SECRET "$(cat "$STATE/secret")" --secret --id "$a" > /dev/null
$bunny scripts env set STORAGE_BASE "https://storage.bunnycdn.com/${PREFIX}parts" --id "$b" > /dev/null
$bunny scripts env set RELEASE r1 --id "$b" > /dev/null
$bunny scripts env set STORAGE_KEY "$(json "$STATE/storage.json" ReadOnlyPassword)" --secret --id "$b" > /dev/null
echo "created ${PREFIX}parts (storage zone and pull zone) and scripts ${PREFIX}a, ${PREFIX}b, ${PREFIX}c"
