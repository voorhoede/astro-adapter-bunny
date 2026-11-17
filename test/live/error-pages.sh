#!/bin/zsh
source ${0:A:h}/lib.sh
check "GET missing" 404 "Custom 404" "$H/missing?$(t)"
check "GET missing nested" 404 "Custom 404" "$H/a/b/c?$(t)"
check "GET dynamic not generated" 404 "Custom 404" "$H/blog/c?$(t)"
check "endpoint own 404" 404 '"error":"not found"' "$H/api/notfound.json?$(t)"
check "POST missing" 404 "Custom 404" -X POST -H "origin: $H" -d x=1 "$H/missing?$(t)"
check "throwing page" 500 "Custom 500" "$H/throws?$(t)"
check "prerendered page" 200 "<h1>About" "$H/about?$(t)"
check "on-demand page" 200 "Product 42" "$H/products/42?$(t)"
report "error pages"
