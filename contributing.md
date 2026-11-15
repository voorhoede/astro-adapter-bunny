# Contributing
To setup and test, follow these steps:

```sh
git clone https://github.com/voorhoede/astro-adapter-bunny.git
cd astro-adapter-bunny
npm ci
npm run check
```

`npm run check` runs the type check and the tests.

Add an entry under `[Unreleased]` in [`changelog.md`](changelog.md) for every change a user of the package would notice.

Decisions and the facts they rest on are in [`docs/adr/`](docs/adr/). Add or update an ADR when a change decides something a later reader would ask about. Each ADR stands on its own: it states the measurements it needs, with how and when they were taken, and links to no other file.

## General Prerequisites
- Node.js, the version in [`.node-version`](.node-version).
- The [bunny CLI](https://bunny.net/docs/cli), logged in, for the live checks.

## How the code is organized

| Module | What it does |
| --- | --- |
| `src/index.ts` | The Astro integration: config overrides, the build output, and bundling the server into `dist/index.js` when Astro built one. |
| `src/script.ts` | The Edge Script: asks storage first for GET and HEAD and renders on a 404, renders other methods directly. |
| `src/lib/bundle-server.ts` | The Rolldown pass that turns Astro's server entry into one file. |
| `src/lib/render-app.ts` | Renders a request with Astro, with the visitor's URL and address, and sets `private, no-store` when the response has no `Cache-Control`. |
| `src/lib/deploy-folder.ts` | Strips the deploy folder an edge rule puts in front of the path, and adds it back for storage, or adds the folder bunny.net's CLI names. |
| `src/lib/needs-trailing-slash-redirect.ts` | Tells whether a path needs Astro's trailing slash redirect before it goes to storage. |
| `src/lib/print-redirects.ts` | Writes Astro's `redirects` in the `_redirects` format for `dist/_redirects`. |
| `src/lib/write-build-manifest.ts` | Writes `.bunny/build.json`, the build manifest in bunny.net's shape. |
| `src/lib/serve-static-asset.ts` | Rewrites a request for a prerendered page to its `.html` file with `build.format` `'file'` or `'preserve'`. |

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

Builds and downloads land in `test/live/.work`, which git ignores. A run leaves the zone on the test app, from the root, without edge rules.

Write the check first and agree on the expected result before the code. A bug fix gets a check that fails before the fix.

## Checks on bunny.net

Some behavior only shows on bunny.net: CDN caching, purges, startup and size limits. Check those on throwaway resources:

- Name every script and pull zone with an `aab-spike-` prefix, state the budget (scripts, requests, purges) before you start, and stay inside it.
- Delete what you created, checking the name before every delete, and list the account afterwards to confirm nothing with the prefix is left.
- Keep keys in `.env`, which is ignored by git. Never print them or commit them.
- Write what you measured into the ADR it decides, with the date and the conditions.
