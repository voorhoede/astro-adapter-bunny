---
status: accepted
date: 2026-10-28, rewritten 2026-10-30
---

# All server code in one plain script

## Context and problem statement

A bunny.net Edge Script is one JavaScript file. Inside an isolate, `import()` fails for every specifier we tried: `data:`, `blob:`, `https:` and relative (measured on 2026-10-28). Astro's server build writes many files: an entry, its middleware, and a `chunks/` folder with one file per page and per lazy dependency. Astro's own build cannot write them as one file, since its server build has several inputs and Rolldown refuses `codeSplitting: false` with more than one (verified with Astro 7.4.2 on 2026-10-30).

bunny.net documents a 10 MB script limit and a 500 ms startup limit (docs.bunny.net/scripting/limits, August 2026). Startup grows with the amount of code: a script of 7 MB of generated code answered cold requests in 1.2 to 1.3 s, and one of 9.4 MB never answered (measured on 2026-10-28).

## Considered options

- **Astro's own build writes one file.** Not possible, see above.
- **A second bundling pass after Astro's build**, from `dist/server` to one file.

## Decision outcome

A second pass. In `astro:build:done`, `build/bundle` runs Rolldown over `dist/server` with code splitting off and writes `dist/index.js`. Every dynamic `import()` becomes part of the same file, so the script imports nothing at runtime except Node builtins.

- **No minify and no source map**, to keep the build simple.
- **The server entry registers itself** through `@bunny.net/edgescript-sdk`, so `build/bundle` knows nothing about bunny.net beyond the builtin checks.
- **Resolved for Deno first.** The server build resolves the `deno` export condition before Vite's defaults, since bunny.net runs Deno. Without it, Astro's build picked the SDK's Node variant, which bundled `@hono/node-server` with `node:http` and `node:stream` into the script (seen with SDK 0.13.0 on 2026-11-03).
- **Node builtins** stay external as `node:` imports. The build fails on `node:child_process`, `node:vm`, `node:worker_threads`, `node:constants` and `node:path/win32`: with any of them the script answered 400 on every request while the publish was accepted (measured on 2026-10-28). A bare package import that Astro left unbundled also fails the build, naming it.
- **Bundler warnings** go through Astro's logger, not straight to the console.
- **Size.** Checked on the whole script: a warning above 7 MB and a build error above 10 MB. The error names the five largest packages in the bundle, so the user knows what to remove.
- **Nothing in `dist/client`.** Server code is never publicly reachable, since a mistake can inline a secret into it. It lives only in the script.

### Consequences

- Good: one file, one bundler pass, nothing loaded or evaluated at runtime.
- Good: Rolldown already ships with Astro, so the pass adds no new bundler.
- Bad: a site pays startup for all its server code on every cold start, not only for the route it serves.
- Bad: one `<Code>` component from `astro:components` adds about 11 MB of server code, since Astro bundles every Shiki language and theme for it (measured with Astro 7.4.2: 11.6 MB of server output for a test app with one `<Code>` block, against 1.35 MB without). Such a site does not fit. A site that never highlights code at runtime can alias Shiki out; syntax highlighting in Markdown happens at build and is not affected.
- Bad: `<Prism>` and Markdown with `syntaxHighlight: 'prism'` fail in on-demand routes, because Prism loads its languages by a path computed at runtime. Prerendered pages are not affected. Not supported for now.
- Open: whether a plain script between 7 and 10 MB starts. To be measured.

### Confirmation

Build tests run the built script under Deno 2.7.12, the runtime bunny.net reports, with a stub for `Bunny.v1.serve`, and check that it loads without the deploy global, that pages render with the same HTML as Astro's server build, that it contains no `import(`, and that `dist/client` holds no server code. Unit tests cover the refused builtins, the unbundled package error and the size thresholds.
