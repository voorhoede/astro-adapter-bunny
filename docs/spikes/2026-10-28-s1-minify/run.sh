#!/bin/bash
# usage: HOSTS=<file of "variant hostname" lines> CELLS="<variant>:<route> ..." ROUNDS=<n> run.sh >> results.jsonl
# Runs Globalping rounds over every cell in turn (one measurement per cell per round, New York, Frankfurt and
# Singapore, one probe each), so drift spreads evenly over the variants.
cd "$(dirname "$0")"
: "${HOSTS:?}" "${CELLS:?}" "${ROUNDS:?}"
for round in $(seq 1 "$ROUNDS"); do
  for cell in $CELLS; do
    variant=${cell%%:*}; route=${cell#*:}
    host=$(awk -v v="$variant" '$1 == v { print $2 }' "$HOSTS")
    node gp.mjs "https://$host/?route=$route" 'New York,Frankfurt,Singapore' 1 1 | sed "s/^{/{\"cell\":\"$variant:${route//\//\\/}\",/"
  done
done
