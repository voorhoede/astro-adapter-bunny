#!/bin/bash
# usage: STORAGE_ZONE=<name> STORAGE_PASSWORD=<write password> upload.sh <dir>; uploads every file under <dir>
cd "$1" && find . -type f | sed 's|^\./||' | while read -r f; do
  curl -s -o /dev/null -w "%{http_code} $f\n" -X PUT "https://storage.bunnycdn.com/$STORAGE_ZONE/$f" \
    -H "AccessKey: $STORAGE_PASSWORD" -H 'content-type: application/octet-stream' --data-binary "@$f"
done
