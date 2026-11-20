#!/bin/zsh
# usage: csp.sh <variant>   the build of a site with security.csp, and its pages behind the header rules
source ${0:A:h}/lib.sh
setopt no_nomatch
D=$WORK/$1/dist
F=$D/client/_headers
ok() { if eval "$2"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $1"; fi; }
ok "_headers exists" "[ -f $F ]"
ok "site lines first" "[ \"\$(head -1 $F)\" = '/*' ]"
ok "no meta csp" "! grep -rqi 'http-equiv=\"content-security-policy\"' $D/client"
ok "about listed" "grep -q '^/about\$' $F"
ok "island listed" "grep -q '^/island\$' $F"
ok "fallbacks not listed" "! grep -q '^/nl/' $F"
ok "no content-type" "! grep -qi 'content-type' $F"
ok "manifest headers" "python3 -I -c \"import json;m=json.load(open('$WORK/$1/.bunny/build.json'));exit(0 if m['astroAdapterBunny'].get('headers')=='dist/client/_headers' else 1)\""
if [ -n "$2" ]; then
  csp() { curl -s -m 30 -D - -o /dev/null "$1" | grep -i '^content-security-policy' | sed 's/^[^:]*: //' | tr -d '\r'; }
  value() { awk -v p="$1" '$0==p{getline; sub(/^ *Content-Security-Policy: */,""); print; exit}' $F; }
  ok "about header" "[ \"\$(csp $H/about/?$(t))\" = \"\$(value /about)\" ]"
  ok "island header" "[ \"\$(csp $H/island/?$(t))\" = \"\$(value /island)\" ]"
  ok "island differs" "[ \"\$(value /island)\" != \"\$(value /about)\" ]"
  ok "on-demand keeps its own" "[ -n \"\$(csp $H/products/42?$(t))\" ] && [ \"\$(csp $H/products/42?$(t))\" != \"\$(value /island)\" ]"
fi
report "csp $1"
