#!/bin/bash
# usage: PREFIX=<name prefix> STATE=<private dir> setup.sh <variant>...
# Creates one standalone script per variant, named <prefix><variant>, with a linked pull zone of the same name.
# API responses stay in STATE (mode 700).
set -e
cd "$(dirname "$0")"
: "${PREFIX:?}" "${STATE:?}" "${BUNNY_API_KEY:?}"
mkdir -p "$STATE"; chmod 700 "$STATE"
for v in "$@"; do
  ./api.sh POST /compute/script "{\"Name\":\"${PREFIX}$v\",\"ScriptType\":1,\"CreateLinkedPullZone\":true,\"LinkedPullZoneName\":\"${PREFIX}$v\"}" > "$STATE/script-$v.json"
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("created", d["Name"])' "$STATE/script-$v.json"
done
