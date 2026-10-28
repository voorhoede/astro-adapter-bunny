#!/bin/bash
# usage: build.sh <probe-standalone.js|probe-middleware.js> <out file>; prints the marker
cd "$(dirname "$0")"
marker="probe-$RANDOM-$(date +%s)"
cat shared.js "$1" | sed "s/__MARKER__/$marker/" > "$2"
echo "$marker"
