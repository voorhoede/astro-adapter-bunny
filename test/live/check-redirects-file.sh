#!/bin/zsh
# usage: check-redirects-file.sh <dist dir>
D=$1; pass=0; fail=0
ok() { if eval "$2"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $1"; fi; }
ok "_redirects exists" "[ -f $D/_redirects ]"
ok "static line" "grep -qE '^/old +/about +301$' $D/_redirects"
ok "dynamic line" "grep -qE '^/old-blog/:slug +/blog/:slug +301$' $D/_redirects"
ok "on-demand line" "grep -qE '^/old-products/:id +/products/:id +301$' $D/_redirects"
ok "not uploaded" "[ ! -f $D/client/_redirects ] || ! grep -q old-blog $D/client/_redirects"
ok "no meta refresh pages" "[ ! -e $D/client/old.html ] && [ ! -e $D/client/old/index.html ] && [ ! -e $D/client/old-blog/a/index.html ] && [ ! -e $D/client/old-blog/a.html ]"
echo "[file] passed $pass, failed $fail"
