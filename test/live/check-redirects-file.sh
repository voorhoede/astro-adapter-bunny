#!/bin/zsh
# usage: check-redirects-file.sh <dist dir>
D=$1; pass=0; fail=0
ok() { if eval "$2"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $1"; fi; }
F=$D/client/_redirects
ok "_redirects exists" "[ -f $F ]"
ok "site lines first" "[ \"\$(head -1 $F)\" = '/from-redirects-file /about 301' ]"
ok "static line" "grep -qE '^/old +/about +301$' $F"
ok "dynamic line" "grep -qE '^/old-blog/:slug +/blog/:slug +301$' $F"
ok "on-demand line" "grep -qE '^/old-products/:id +/products/:id +301$' $F"
ok "no meta refresh pages" "[ ! -e $D/client/old.html ] && [ ! -e $D/client/old/index.html ] && [ ! -e $D/client/old-blog/a/index.html ] && [ ! -e $D/client/old-blog/a.html ]"
echo "[redirects file] passed $pass, failed $fail"
