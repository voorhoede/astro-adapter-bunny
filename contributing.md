# Contributing
To setup and test, follow these steps:

```sh
git clone https://github.com/voorhoede/astro-adapter-bunny.git
cd astro-adapter-bunny
npm ci
npm run check
```

`npm run check` runs the type check and the tests.

## Building

The package ships JavaScript from `dist/`, which git ignores: its `exports` point there, also for `test/adapter-test`, which links to the package. `npm ci` builds it, as does `npm pack`. After changing anything in `src/`, run:

```sh
npm run build
```

`rolldown.config.ts` builds one file per export, with every bare import left to the installing project except `@std/*` and `@jsr/*`, which are bundled. `tsconfig.build.json` writes the type declarations for the main export into `dist/types/`.

Add an entry under `[Unreleased]` in [`changelog.md`](changelog.md) for every change a user of the package would notice.

Decisions and the facts they rest on are in [`docs/adr/`](docs/adr/). Add or update an ADR when a change decides something a later reader would ask about. Each ADR stands on its own: it states the measurements it needs, with how and when they were taken, and links to no other file.

## General Prerequisites
- Node.js, the version in [`.node-version`](.node-version).
- The [bunny CLI](https://bunny.net/docs/cli), logged in, for the live checks.

## How the code is organized

Build-time code runs in Node while Astro builds; runtime code is bundled into the Edge Script.

| Module | What it does |
| --- | --- |
| `rolldown.config.ts` | Builds the exports into `dist/`. |
| `src/index.ts` | The Astro integration: config overrides, the build output, and bundling the server into `dist/index.js` when Astro built one. |
| `src/lib/build/lib/adapter.ts` | What the adapter declares to Astro, and the server build config that resolves Deno first. |
| `src/lib/build/lib/image-service.ts` | Turns the `imageService` option into Astro's build and runtime image services. |
| `src/lib/build/lib/bundle-server.ts` | The Rolldown pass that turns Astro's server entry into one file, with Node builtins as `node:` imports. |
| `src/lib/build/lib/check-script.ts` | Fails the build on a script over 10 MB or with a builtin bunny.net cannot run, and warns above 7 MB. |
| `src/lib/build/lib/print-redirects.ts` | Writes Astro's `redirects` in the `_redirects` format. |
| `src/lib/build/lib/print-headers.ts` | Writes each prerendered page's Content-Security-Policy in the `_headers` format. |
| `src/lib/build/lib/write-static-files.ts` | Appends the redirects and headers to `_redirects` and `_headers` in the client build, after a site's own lines. |
| `src/lib/build/lib/write-script.ts` | Bundles, checks and writes `dist/index.js`. |
| `src/lib/build/lib/write-build-manifest.ts` | Writes `.bunny/build.json`, the build manifest in bunny.net's shape. |
| `src/lib/runtime/script.ts` | The Edge Script: asks storage first for GET and HEAD and renders on a 404, renders other methods directly, and answers 405 for those on stored paths. |
| `src/lib/runtime/lib/render-app.ts` | Renders a request with Astro, with the visitor's request and address, and sets `private, no-store` when the response has no `Cache-Control`. |
| `src/lib/runtime/lib/bunny-helpers.ts` | Translates between bunny.net and Astro: the visitor's request, the storage request and response, the client address, and whether a path is stored. |
| `src/lib/runtime/lib/deploy-folder.ts` | Strips the deploy folder an edge rule puts in front of the path, and adds it back for storage, or adds the folder bunny.net's CLI names. |
| `src/lib/runtime/lib/needs-trailing-slash-redirect.ts` | Tells whether a path needs Astro's trailing slash redirect before it goes to storage. |
| `src/lib/runtime/lib/cache-control.ts` | The `Cache-Control` for rendered responses and stored files. |
| `src/lib/runtime/lib/content-type.ts` | The content type for extensions storage answers as `application/octet-stream`. |
| `src/lib/preview/preview.ts` | `astro preview`: starts the built `run-script.js` with Deno and stops it with the preview. |
| `src/lib/preview/run-script.ts` | Runs the built script under Deno on Astro's host and port, with the headers bunny.net sets and `dist/client` as storage. |

## Tests

The adapter is checked on bunny.net itself, by `test/live/`. Each suite builds a variant of `test/adapter-test`, uploads it, publishes the script, and checks the responses with `curl`:

```sh
cp test/live/.env.example test/live/.env   # fill in the test zones and script
test/live/run.sh                           # every suite
test/live/run.sh regress formats           # some suites
```

| Suite | What it covers |
| --- | --- |
| `regress` | The test app from the zone root: rendering, files, cache headers, redirects, cookies, actions, i18n, `Astro.clientAddress` |
| `folder` | The same app from a deploy folder behind the edge rules |
| `formats` | `build.format` `'file'` and `'preserve'` |
| `trailing` | `trailingSlash` `'always'` and `'never'` |
| `errors` | A prerendered `404.astro` through `Custom404FilePath` |
| `manifest` | `.bunny/build.json` and `dist/_redirects`, without a deploy |
| `base` | `base: '/docs'`, from the root and from a deploy folder |

`test/live/run.sh` builds the package first. Builds and downloads land in `test/live/.work`, which git ignores. A run leaves the zone on the test app, from the root, without edge rules.

Write the check first and agree on the expected result before the code. A bug fix gets a check that fails before the fix.

## Checks on bunny.net

Some behavior only shows on bunny.net: CDN caching, purges, startup and size limits. Check those on throwaway resources:

- Name every script and pull zone with an `aab-spike-` prefix, state the budget (scripts, requests, purges) before you start, and stay inside it.
- Delete what you created, checking the name before every delete, and list the account afterwards to confirm nothing with the prefix is left.
- Keep keys in `.env`, which is ignored by git. Never print them or commit them.
- Write what you measured into the ADR it decides, with the date and the conditions.

## Releasing

1. Move the entries under `[Unreleased]` in [`changelog.md`](changelog.md) to a heading with the new version and the date, and set the same version in `package.json`.
2. Merge that to `main`, then push a tag with the version, such as `git tag v0.2.0 && git push origin v0.2.0`.

The [release workflow](.github/workflows/release.yml) checks the tag against `package.json` and publishes to npm with trusted publishing, which adds provenance. The tag also releases the actions in `actions/`, which share it.
