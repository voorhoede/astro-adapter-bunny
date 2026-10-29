#!/bin/bash
# usage: PREFIX=<name prefix> [LIST_ONLY=1] teardown.sh
# Deletes scripts, pull zones and storage zones whose name starts with PREFIX, reading each name back before its
# delete, then lists what is left with the prefix. Never touches anything else.
cd "$(dirname "$0")"
: "${PREFIX:?}" "${BUNNY_API_KEY:?}"
list() { ./api.sh GET "$1" | python3 -c 'import json,sys
d=json.load(sys.stdin); d=d.get("Items",d) if isinstance(d,dict) else d
for x in d:
  if x["Name"].startswith(sys.argv[1]): print(x["Id"], x["Name"])' "$PREFIX"; }
remove() {
  name=$(./api.sh GET "$1/$2" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("Name",""))')
  case "$name" in "$PREFIX"*) curl -s -o /dev/null -w "delete $name %{http_code}\n" -X DELETE "https://api.bunny.net$1/$2$3" -H "AccessKey: $BUNNY_API_KEY";;
    *) echo "skip $2: name '$name' lacks the prefix";; esac
}
if [ -n "$LIST_ONLY" ]; then list "/compute/script?perPage=1000"; list "/pullzone?perPage=1000"; list "/storagezone?perPage=1000"; exit; fi
list "/compute/script?perPage=1000" | while read -r id _; do remove /compute/script "$id" "?deleteLinkedPullZones=true"; done
list "/pullzone?perPage=1000" | while read -r id _; do remove /pullzone "$id"; done
list "/storagezone?perPage=1000" | while read -r id _; do remove /storagezone "$id"; done
sleep 5
echo "left: scripts [$(list "/compute/script?perPage=1000" | tr '\n' ' ')] pull zones [$(list "/pullzone?perPage=1000" | tr '\n' ' ')] storage zones [$(list "/storagezone?perPage=1000" | tr '\n' ' ')]"
