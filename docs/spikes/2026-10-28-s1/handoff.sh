#!/bin/bash
# usage: URL=<middleware pull zone url> handoff.sh; step 4. Run against a freshly published probe-middleware.js.
show() { curl -s -D "$tmp" "$URL$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("  id", d.get("id"), "| seenUrl", d.get("seenUrl"), "| query", d.get("seenQuery"), "| header", d.get("seenHeader"), "| storage", d.get("storageStatus"), d.get("storageBody","")[:40].replace("\n"," "), "| storage etag", d.get("storageHeaders",{}).get("etag"), "| storage type", d.get("storageHeaders",{}).get("content-type"))'; echo "  cdn-cache=$(grep -i '^cdn-cache:' "$tmp" | cut -d' ' -f2 | tr -d '\r')"; }
tmp=$(mktemp)
for p in /page /page /alias /alias "/page?v=2" /pre/page.html; do echo "GET $p"; show "$p"; done
echo "GET /pre/page.html raw"; curl -s -D - "$URL/pre/page.html" | grep -iE '^(HTTP|cdn-cache|content-type)|title'
