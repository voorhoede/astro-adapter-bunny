#!/bin/bash
# usage: URL=<pull zone url> subrequests.sh; N cache operations, then storage fetches until one fails
for spec in "ops=0" "ops=10&kind=match" "ops=10&kind=put" "ops=60&kind=match"; do
  curl -s "$URL/sub?$spec&r=$RANDOM" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(" ", d.get("ops"), d.get("kind"), "opErrors", len(d.get("opErrors", [])), (d.get("opErrors") or [""])[0][:100], "| fetches ok", d.get("fetches"), "| first failure", d.get("firstFailure"), d.get("error", "")[:200])'
done
