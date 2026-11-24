# Shared helpers for the live checks. Source it; it reads test/live/.env.
LIVE=${0:A:h}
ROOT=${LIVE:h:h}
WORK=$LIVE/.work
mkdir -p $WORK
[ -f $LIVE/.env ] && source $LIVE/.env
: ${BUNNY_TEST_STORAGE_ZONE:?set it in test/live/.env} ${BUNNY_TEST_STORAGE_ZONE_ID:?} ${BUNNY_TEST_PULL_ZONE_ID:?} ${BUNNY_TEST_SCRIPT_ID:?} ${BUNNY_TEST_HOST:?}
H=$BUNNY_TEST_HOST
pass=0; fail=0

# check <name> <status> <pattern in headers or body> <curl args...>
check() {
  local name=$1 exp=$2 pat=$3; shift 3
  local st=$(curl -s -m 30 -D $WORK/headers -o $WORK/body -w '%{http_code}' "$@")
  if [ "$st" = "$exp" ] && { [ -z "$pat" ] || cat $WORK/headers $WORK/body | LC_ALL=C grep -qiE -- "$pat"; }; then
    pass=$((pass+1))
  else
    fail=$((fail+1)); echo "FAIL $name: got $st, want $exp ${pat:+/$pat/}"
  fi
}
t() { echo "t=$RANDOM$RANDOM"; }
report() { echo "[$1] passed $pass, failed $fail"; }

timeout() { local s=$1; shift; perl -e "alarm $s; exec @ARGV" "$@"; }
api() { timeout 90 bunny api "$@"; }

# variant <name>: a copy of test/adapter-test in .work with a changed config and extra pages.
variant() {
  local name=$1 dir=$WORK/$1 config=$2 fixtures=$3
  rm -rf $dir && mkdir -p $dir
  (cd $ROOT/test/adapter-test && tar --exclude node_modules --exclude dist --exclude .astro --exclude .bunny -cf - .) | (cd $dir && tar -xf -)
  ln -s $ROOT/test/adapter-test/node_modules $dir/node_modules
  [ -n "$config" ] && sed -i '' "s|defineConfig({|defineConfig({ $config|" $dir/astro.config.mjs
  [ -n "$fixtures" ] && cp -R $LIVE/fixtures/$fixtures/. $dir/
  echo $dir
}

astro_key() {
  [ -f $WORK/astro-key ] || (cd $ROOT/test/adapter-test && npx astro create-key 2>/dev/null | grep -o 'ASTRO_KEY=.*' | cut -d= -f2- > $WORK/astro-key)
  cat $WORK/astro-key
}

build() { (cd $1 && rm -rf dist .bunny && PUBLIC_SERVER_VALUE=server-at-build ASTRO_KEY=$(astro_key) npx astro build 2>&1 | grep -E "Complete!|rror" | tail -1); }

clear_zone() {
  for o in $(bunny storage files list / -z $BUNNY_TEST_STORAGE_ZONE --output json 2>/dev/null | python3 -I -c 'import json,sys;[print(x["objectName"]+("/" if x["isDirectory"] else "")) for x in json.load(sys.stdin)]'); do
    timeout 120 bunny storage files rm "$o" -z $BUNNY_TEST_STORAGE_ZONE -f >/dev/null 2>&1 || echo "rm failed $o"
  done
}

# upload <dir> [prefix]
upload() {
  (cd $1 && for f in $(find . -type f | sed 's#^\./##'); do
    timeout 60 bunny storage files upload "$f" -z $BUNNY_TEST_STORAGE_ZONE --to "${2:+$2/}$f" >/dev/null 2>&1 || echo "upload failed $f"
  done)
}

publish() { (cd ${1:h} && timeout 120 bunny scripts deploy ${1:t} $BUNNY_TEST_SCRIPT_ID >/dev/null 2>&1) || echo "publish failed"; }
purge() { api POST /pullzone/$BUNNY_TEST_PULL_ZONE_ID/purgeCache >/dev/null 2>&1; }
settle() { perl -e 'select(undef,undef,undef,40)'; }

# rules_down removes the edge rules the live checks added.
rules_down() {
  for g in $(api GET /pullzone/$BUNNY_TEST_PULL_ZONE_ID 2>/dev/null | python3 -I -c 'import json,sys;[print(r["Guid"]) for r in json.load(sys.stdin)["EdgeRules"] if r["Description"].startswith("aab-live-")]'); do
    api DELETE /pullzone/$BUNNY_TEST_PULL_ZONE_ID/edgerules/$g >/dev/null 2>&1 || echo "rule delete failed $g"
  done
}

storage_404() { api POST /storagezone/$BUNNY_TEST_STORAGE_ZONE_ID --body "{\"Custom404FilePath\":\"$1\",\"Rewrite404To200\":false}" >/dev/null 2>&1; }

# deploy <app dir>: build, clear the zone, upload, publish, purge. BASE_PATH uploads under the site's base.
deploy() {
  local app=$1 prefix="${BASE_PATH#/}"
  build $app || return 1
  clear_zone
  upload $app/dist/client $prefix
  [ -f $app/dist/index.js ] && publish $app/dist/index.js
  purge; settle
}
