#!/bin/zsh
source ${0:A:h}/lib.sh
loc() { echo "^location: $1[[:space:]]*\$"; }
A=$(ls $WORK/$1/dist/client/_astro | head -1)
case $1 in
always)
  check "/about" 301 "$(loc /about/)" "$H/about"
  check "/about/" 200 "<h1>About" "$H/about/"
  check "/about?x=1" 301 "$(loc '/about/\?x=1')" "$H/about?x=1"
  check "/blog/a/" 200 "Blog post a" "$H/blog/a/"
  check "/blog/a" 301 "$(loc /blog/a/)" "$H/blog/a"
  check "/products/42" 301 "$(loc /products/42/)" "$H/products/42"
  check "/products/42/" 200 "Product 42" "$H/products/42/"
  check "/about//" 301 "$(loc /about/)" "$H/about//"
  check "HEAD /about" 301 "" -I "$H/about"
  check "POST /api/echo" 308 "$(loc /api/echo/)" -X POST -H "origin: $H" -d m=1 "$H/api/echo"
  check "/missing" 301 "$(loc /missing/)" "$H/missing"
  check "/missing/" 404 "Custom 404" "$H/missing/" ;;
never)
  check "/about" 200 "<h1>About" "$H/about"
  check "/about/" 301 "$(loc /about)" "$H/about/"
  check "/about/?x=1" 301 "$(loc '/about\?x=1')" "$H/about/?x=1"
  check "/blog/a" 200 "Blog post a" "$H/blog/a"
  check "/blog/a/" 301 "$(loc /blog/a)" "$H/blog/a/"
  check "/products/42" 200 "Product 42" "$H/products/42"
  check "/products/42/" 301 "$(loc /products/42)" "$H/products/42/"
  check "/about//" 301 "$(loc /about)" "$H/about//"
  check "HEAD /about/" 301 "" -I "$H/about/"
  check "POST /api/echo" 200 "received" -X POST -H "origin: $H" -d m=1 "$H/api/echo"
  check "/missing/" 301 "$(loc /missing)" "$H/missing/"
  check "/missing" 404 "Custom 404" "$H/missing" ;;
ignore)
  check "/about" 200 "<h1>About" "$H/about"
  check "/about/" 200 "<h1>About" "$H/about/"
  check "/about//" 301 "$(loc /about/)" "$H/about//" ;;
esac
check "/" 200 "" "$H/"
check "/favicon.svg" 200 "" "$H/favicon.svg"
check "/_astro asset" 200 "" "$H/_astro/$A"
check "/CNAME" 200 "example.com" "$H/CNAME"
report "trailing slash $1"
