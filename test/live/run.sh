#!/bin/zsh
# Live checks against throwaway bunny.net resources (see test/live/.env.example).
# usage: test/live/run.sh [regress|folder|formats|trailing|errors|manifest|base]...  (no argument runs all)
source ${0:A:h}/lib.sh

prerender_index() { sed -i '' "1s/^---$/---\nexport const prerender = true;/" $1/src/pages/index.astro; }

static_app() {
  local dir=$WORK/$1; rm -rf $dir && mkdir -p $dir
  cp -R $LIVE/fixtures/static/. $dir/
  ln -s $ROOT/test/adapter-test/node_modules $dir/node_modules
  echo '{"name":"static-app","type":"module","private":true}' > $dir/package.json
  echo "import { defineConfig } from 'astro/config';\nimport bunny from 'astro-adapter-bunny';\nexport default defineConfig({ adapter: bunny(), $2 });" > $dir/astro.config.mjs
  echo $dir
}

suite_regress() { deploy $ROOT/test/adapter-test && zsh $LIVE/regress.sh; }

suite_folder() {
  deploy $ROOT/test/adapter-test live1
  echo "from deploy live1" > $WORK/marker.txt
  timeout 60 bunny storage files upload $WORK/marker.txt -z $BUNNY_TEST_STORAGE_ZONE --to deploys/live1/marker.txt >/dev/null 2>&1
  rules live1; settle
  zsh $LIVE/deploy-folder-checks.sh live1
  zsh $LIVE/regress.sh
  rules_down
}

suite_formats() {
  for f in file preserve; do
    local dir=$(variant $f "build: { format: '$f' }," formats)
    prerender_index $dir
    deploy $dir && zsh $LIVE/format-routes.sh $f
  done
}

suite_trailing() {
  for m in always never; do
    deploy $(variant $m "build: { format: 'directory' }, trailingSlash: '$m',") && zsh $LIVE/trailing-slash.sh $m
  done
}

suite_errors() {
  storage_404 /404.html
  deploy $(variant errors "" errors) && zsh $LIVE/error-pages.sh
  storage_404 ""
}

suite_manifest() {
  build $ROOT/test/adapter-test >/dev/null
  python3 -I $LIVE/check-manifest.py $ROOT/test/adapter-test ssr
  zsh $LIVE/check-redirects-file.sh $ROOT/test/adapter-test/dist
  local dir=$(static_app static "build: { inlineStylesheets: 'never' }")
  build $dir >/dev/null; python3 -I $LIVE/check-manifest.py $dir static
  dir=$(static_app static-redirects "redirects: { '/old': '/about' }")
  build $dir >/dev/null; python3 -I $LIVE/check-manifest.py $dir static-redirects
  dir=$(variant outdir "build: { format: 'file' }, outDir: 'build',")
  build $dir >/dev/null; python3 -I $LIVE/check-manifest.py $dir outdir
}

suite_base() {
  local dir=$(variant base "base: '/docs',")
  BASE_PATH=/docs deploy $dir && zsh $LIVE/base.sh base
  grep -qE '^/docs/old +/about +301$' $dir/dist/_redirects && echo "[base redirects file] ok" || echo "FAIL base redirects file"
  python3 -I -c "import json,sys;m=json.load(open('$dir/.bunny/build.json'));print('[base manifest] ok' if m['astroAdapterBunny'].get('base')=='/docs' else 'FAIL base manifest')"
  BASE_PATH=/docs deploy $dir live2
  rules live2; settle
  zsh $LIVE/base.sh base
  rules_down
}

suites=($@)
(( $#suites )) || suites=(regress folder formats trailing errors manifest base)
for s in $suites; do echo "== $s"; suite_$s; done

# Leave the zone on the test app, from the root, without rules.
rules_down; storage_404 ""
deploy $ROOT/test/adapter-test >/dev/null
