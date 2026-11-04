# Contributing
To setup and test, follow these steps:

```sh
git clone https://github.com/voorhoede/astro-adapter-bunny.git
cd astro-adapter-bunny
npm ci
npm run check
```

`npm run check` runs formatting, lint, the type check and the tests. The pre-commit hook in `.husky/` runs the same before every commit.

Add an entry under `[Unreleased]` in [`changelog.md`](changelog.md) for every change a user of the package would notice.

Decisions and the facts they rest on are in [`docs/adr/`](docs/adr/). Add or update an ADR when a change decides something a later reader would ask about. Each ADR stands on its own: it states the measurements it needs, with how and when they were taken, and links to no other file.

## General Prerequisites
- Node.js, the version in [`.node-version`](.node-version).
- [Deno](https://deno.com/), for the tests that run a built script the way bunny.net does. CI uses 2.7.12, the version bunny.net reports.

## How the code is organized

| Module | What it does |
| --- | --- |
| `src/routing` | What a request becomes: render, redirect, or a stored file with what to do when storage has none. Pure, no Astro or bunny.net imports. |
| `src/caching` | `finalize`, which gives every response its `Cache-Control` and applies `_headers` to stored files, and the bunny.net CDN cache provider. |
| `src/runtime` | The request handlers both script types share, `platform` (the only module that reads bunny.net globals) and `storage` (Storage API reads). |
| `src/scripts` | The two server entries, `middleware` and `standalone`, which register with bunny.net through `@bunny.net/edgescript-sdk`. |
| `src/build` | The Astro integration: config overrides, the `_headers` and `_redirects` parsers, `bundle` (one Rolldown pass to `dist/index.js`), the size check and `.bunny/build.json`. |
| `src/preview` | `astro preview`: the built script behind a local stand-in for the pull zone. |

A request is decided by `routing.decide` as data, and each script type only interprets that decision with its own I/O, so routing rules are tested as tables without a runtime.

## Tests

- **Unit tests** sit next to the code as `src/<module>/<name>.test.ts`, and run on Node with `node:test`.
- **Build tests** build `test/app` and the fixtures in `test/fixtures/` with Astro, and check what lands in `dist` and `.bunny/build.json`.
- **Runtime tests** run the built `dist/index.js` under Deno through `test/harness/`, with a stub for the `Bunny` global, a fake Storage API and the same pull zone stand-in `astro preview` uses.

Write the test first and agree on the expected result before the code. A bug fix gets a test that fails before the fix.

## Checks on bunny.net

Some behavior only shows on bunny.net: CDN caching, purges, startup and size limits. Check those on throwaway resources:

- Name every script and pull zone with an `aab-spike-` prefix, state the budget (scripts, requests, purges) before you start, and stay inside it.
- Delete what you created, checking the name before every delete, and list the account afterwards to confirm nothing with the prefix is left.
- Keep keys in `.env`, which is ignored by git. Never print them or commit them.
- Write what you measured into the ADR it decides, with the date and the conditions.
