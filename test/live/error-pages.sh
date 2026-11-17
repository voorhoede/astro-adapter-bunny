#!/bin/zsh
# usage: [P=<base>] error-pages.sh <label>
source ${0:A:h}/lib.sh
check "GET missing" 404 "Custom 404" "$H$P/missing?$(t)"
check "GET missing nested" 404 "Custom 404" "$H$P/a/b/c?$(t)"
check "GET dynamic not generated" 404 "Custom 404" "$H$P/blog/c?$(t)"
check "endpoint own 404" 404 '"error":"not found"' "$H$P/api/notfound.json?$(t)"
check "POST missing" 404 "Custom 404" -X POST -H "origin: $H" -d x=1 "$H$P/missing?$(t)"
check "throwing page" 500 "Custom 500" "$H$P/throws?$(t)"
check "prerendered page" 200 "<h1>About" "$H$P/about?$(t)"
check "on-demand page" 200 "Product 42" "$H$P/products/42?$(t)"
report "error pages $1"
