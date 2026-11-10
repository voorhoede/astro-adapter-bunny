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
- [Deno](https://deno.com/), for the tests that run a built script the way bunny.net does. CI uses 2.7.12, the version bunny.net reports.

## How the code is organized

| Module | What it does |
| --- | --- |
| `src/index.ts` | The Astro integration: config overrides and one Rolldown pass that bundles the server into `dist/index.js`. |
| `src/script.ts` | The Edge Script: renders on-demand routes and lets the pull zone serve stored files. |

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
