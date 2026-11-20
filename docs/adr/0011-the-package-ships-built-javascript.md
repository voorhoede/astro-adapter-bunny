---
status: accepted
date: 2026-11-20
---

# The package ships built JavaScript

## Context and problem statement

The package exported its TypeScript sources: `src/index.ts` as the integration, `src/lib/runtime/script.ts` as Astro's server entrypoint and `src/lib/preview/preview.ts` as its preview entrypoint. `preview.ts` starts `src/lib/preview/run-script.ts` under Deno, which imports `serveDir` from `@std/http`, installed as `npm:@jsr/std__http` through `@jsr:registry=https://npm.jsr.io` in the repository's `.npmrc`.

Measured on 2026-11-20 with Node 24.19, Astro 7.4, Deno 2.9 and npm 11, by installing `npm pack` output into a copy of the test app instead of linking the repository:

- `astro build` worked: Astro loads the integration and the server entrypoint through Vite, which strips types also under `node_modules`.
- `astro preview` failed. Astro loads the preview entrypoint with Node, which refused `preview.ts` with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Through the repository's `file:../..` link the sources sit outside `node_modules`, which is why the test app never showed it.
- The install only resolved `@std/http` with the JSR registry configured. npmjs.org does not host `@jsr/std__http`.

## Considered options

- **Build the preview pair only.** `preview.js` and `run-script.js` into `dist/`, the other exports stay sources, since Vite loads them.
- **Build every export**, with type declarations for the integration.
- **Write `preview.ts` as JavaScript with JSDoc**, and bundle only the runner.

## Decision outcome

Build every export, so every export is loaded the same way and no consumer depends on how Astro happens to load an entrypoint.

- **Rolldown builds `dist/`**, from `rolldown.config.ts`: `index.js`, `script.js`, `preview.js` and `run-script.js`, with a shared chunk where two of them import the same module. Rolldown already runs in the adapter, so the build adds no dependency.
- **Bare imports stay external**, so the installing project's own copies are used: Astro, the edge script SDK, Rolldown, `@astrojs/internal-helpers`, `#package.json` and Node builtins. The runner hands the script's hooks to the installed SDK's pull zone handler, which keeps that the consumer's copy.
- **`@std/*` and `@jsr/*` are bundled**, and `@std/http` is a dev dependency, so installing the package needs no other registry. `@std/http/file-server` starts its own server when `import.meta.main` is true, which it is for the bundled runner under Deno, so the build defines it as `false`.
- **`tsc` writes declarations** for the main export into `dist/types/`, which `exports` names as its `types`.
- **The exports are `.`, `./script.js` and `./preview.js`**, and `files` is `dist` only.
- **`prepare` runs the build**, so `npm ci` and `npm pack` build it.

### Consequences

- Good: `astro preview` works from an installed package, and installing needs only npmjs.org.
- Good: the edge script built from `dist/script.js` held the same code as the one built from the sources: the test app's `dist/index.js` from both differed only in chunk hashes, where the deploy id constants sit, the entrypoint's name and Astro's random key (compared on 2026-11-20).
- Bad: `test/adapter-test` and the live checks run `dist/`, so a change in `src/` needs `npm run build` before it shows. `test/live/run.sh` builds first.
- Bad: `run-script.js` is about 300 kB, most of it the media type table `serveDir` uses.

### Confirmation

On 2026-11-20, the packed tarball installed into a copy of the test app without an `.npmrc`, with no `@jsr` or `@std` packages in its `node_modules`. `astro build` completed, and `astro preview` served `/` and `/about` with 200, `/favicon.svg` as `image/svg+xml`, `/old` with 301, a missing path with 404, `/client-address.json` with the client's address and `/request.json` with `Astro.url` on the preview's host and port. `astro preview stop` left no Deno process. A TypeScript file in that project typed `bunny()` and `Options` from the declarations, and rejected an unknown `imageService`. In the repository, `test/adapter-test` built and previewed through its link.
