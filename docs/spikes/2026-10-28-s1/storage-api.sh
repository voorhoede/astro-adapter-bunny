#!/bin/bash
# usage: STORAGE_ZONE=<name> STORAGE_KEY=<read-only password> storage-api.sh; step 6
base="https://storage.bunnycdn.com/$STORAGE_ZONE"
for f in t/a.css t/a.js t/a.svg t/a.webmanifest t/a.html t/noext; do
  echo "== $f"
  curl -s -D - -o /dev/null "$base/$f" -H "AccessKey: $STORAGE_KEY" | grep -iE '^(HTTP|content-type|etag|last-modified|cache-control|accept-ranges|content-length)'
done
etag=$(curl -s -D - -o /dev/null "$base/t/a.html" -H "AccessKey: $STORAGE_KEY" | grep -i '^etag' | cut -d' ' -f2- | tr -d '\r')
lm=$(curl -s -D - -o /dev/null "$base/t/a.html" -H "AccessKey: $STORAGE_KEY" | grep -i '^last-modified' | cut -d' ' -f2- | tr -d '\r')
echo "== Range bytes=0-9"; curl -s -D - -o /dev/null "$base/t/a.html" -H "AccessKey: $STORAGE_KEY" -H 'range: bytes=0-9' | grep -iE '^(HTTP|content-range|content-length)'
echo "== If-None-Match $etag"; curl -s -D - -o /dev/null "$base/t/a.html" -H "AccessKey: $STORAGE_KEY" -H "if-none-match: $etag" | grep -iE '^(HTTP|content-length|etag)'
echo "== If-None-Match W/$etag"; curl -s -D - -o /dev/null "$base/t/a.html" -H "AccessKey: $STORAGE_KEY" -H "if-none-match: W/$etag" | grep -iE '^(HTTP|content-length)'
echo "== If-Modified-Since $lm"; curl -s -D - -o /dev/null "$base/t/a.html" -H "AccessKey: $STORAGE_KEY" -H "if-modified-since: $lm" | grep -iE '^(HTTP|content-length)'
echo "== query string ignored?"; curl -s -o /dev/null -w "%{http_code} %{size_download}\n" "$base/t/a.html?x=1" -H "AccessKey: $STORAGE_KEY"
