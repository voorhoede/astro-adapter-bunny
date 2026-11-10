---
status: accepted; open (where between 7 and 10 MB a script stops starting, size and builtin checks)
date: 2026-10-28, rewritten 2026-11-10
---

# All server code in one plain script

## Context and problem statement

A bunny.net Edge Script is one JavaScript file. Inside an isolate, `import()` fails for every specifier tried: `data:`, `blob:`, `https:` and relative (measured on 2026-10-28). Astro's server build writes many files: an entry, its middleware and a `chunks/` folder with one file per page and per lazy dependency. Astro's own build cannot write them as one file, since its server build has several inputs and Rolldown refuses `codeSplitting: false` with more than one (verified with Astro 7.4.2 on 2026-10-30). A Vite plugin cannot bundle them either: Astro writes the manifest into the server chunks after Vite finishes, so a bundle made in `generateBundle` or `writeBundle` would miss it (read in Astro 7.4's build source on 2026-11-04).

bunny.net documents a 10 MB script limit and a 500 ms startup limit (docs.bunny.net/scripting/limits, August 2026). Startup grows with the amount of code: 7 MB of generated code answered cold requests in 1.2 to 1.3 s, and 9.4 MB never answered (measured on 2026-10-28).

## Considered options

- **Astro's own build writes one file.** Not possible, see above.
- **A Vite plugin in Astro's build.** Runs before Astro writes the manifest.
- **A second bundling pass after Astro's build**, from `dist/server` to one file.

## Decision outcome

A second pass. In `astro:build:done`, `src/index.ts` runs Rolldown over Astro's server entry with code splitting off and writes `dist/index.js`. Every dynamic `import()` becomes part of the same file.

- **No minify and no source map**, to keep the build simple.
- **Everything is bundled** (`ssr.noExternal: true`), and Rolldown runs with `platform: 'node'`, so Node builtins stay external imports.
- **Resolved for Deno first.** The server build resolves the `deno` export condition before Vite's defaults, since bunny.net runs Deno. Without it, the build picked the SDK's Node variant, which bundled `@hono/node-server` with `http`, `http2`, `stream` and `crypto` imports into the script (seen with SDK 0.13.0 on 2026-11-03 and again on 2026-11-04).
- **Sharp stays out.** The adapter splits the image service into Sharp at build and the no-op service at runtime. With Sharp at runtime, the bundle imported `node:child_process`.

### Consequences

- Good: one file, one bundler pass, nothing loaded or evaluated at runtime.
- Good: Rolldown already ships with Astro, so the pass adds no new bundler.
- Bad: every cold start pays for all server code, not only for the route it serves.
- Bad: there is no size check. One `<Code>` from `astro:components` adds about 11 MB of server code, since Astro bundles every Shiki language and theme for it (measured with Astro 7.4.2: 11.6 MB of server output for a test app with one `<Code>` block, against 1.35 MB without), and such a script does not start.
- Bad: there is no builtin check. With `node:child_process`, `node:vm`, `node:worker_threads`, `node:constants` or `node:path/win32` the script answered 400 on every request while the publish was accepted (measured on 2026-10-28).
- Bad: `<Prism>` and Markdown with `syntaxHighlight: 'prism'` fail in on-demand routes, because Prism loads its languages by a path computed at runtime. Prerendered pages are not affected.

### Confirmation

The test app's script holds no top-level imports, no Hono and no Sharp (checked on 2026-11-04 and 2026-11-10: about 0.6 to 0.8 MB). It runs on bunny.net and renders every case of the test app.
