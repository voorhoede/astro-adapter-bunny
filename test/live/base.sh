#!/bin/zsh
# usage: base.sh <variant>   checks a build with base: '/docs', uploaded under docs/
source ${0:A:h}/lib.sh
A=$(ls $WORK/$1/dist/client/_astro | grep -m1 '\.css$\|\.svg$')
check "base root" 200 "" "$H/docs/?$(t)"
check "prerendered page" 200 "<h1>About" "$H/docs/about?$(t)"
check "prerendered trailing slash" 200 "<h1>About" "$H/docs/about/?$(t)"
check "prerendered dynamic" 200 "Blog post a" "$H/docs/blog/a?$(t)"
check "on-demand page" 200 "Product 42" "$H/docs/products/42?$(t)"
check "asset immutable" 200 "immutable" "$H/docs/_astro/$A"
check "public file revalidate" 200 "max-age=0, must-revalidate" "$H/docs/favicon.svg?$(t)"
check "missing under base" 404 "Custom 404" "$H/docs/missing?$(t)"
check "outside base" 404 "" "$H/about?$(t)"
check "redirect to prerendered" 301 "location: /about" "$H/docs/old?$(t)"
check "redirect to on-demand" 301 "location: /products/42" "$H/docs/old-products/42?$(t)"
check "POST endpoint" 200 "received" -X POST -H "origin: $H" -d m=1 "$H/docs/api/echo"
check "POST on file" 405 "allow: GET, HEAD" -X POST -H "origin: $H" -d m=1 "$H/docs/favicon.svg"
check "astro url" 200 "\"astroUrl\":\"$H/docs/request.json" "$H/docs/request.json"
report base
