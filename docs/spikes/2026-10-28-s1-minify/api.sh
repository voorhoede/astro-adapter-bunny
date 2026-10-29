#!/bin/bash
# usage: api.sh <method> <path> [json body]; calls the bunny.net API with BUNNY_API_KEY
if [ -n "$3" ]; then
  curl -s -X "$1" "https://api.bunny.net$2" -H "AccessKey: $BUNNY_API_KEY" -H 'content-type: application/json' --data "$3"
else
  curl -s -X "$1" "https://api.bunny.net$2" -H "AccessKey: $BUNNY_API_KEY"
fi
