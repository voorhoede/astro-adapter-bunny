---
status: accepted
date: 2026-10-28, updated 2026-11-04
---

# One request decision, two script types

## Context and problem statement

The adapter runs as a bunny.net Edge Script in one of two types. A middleware script sits in front of a pull zone whose origin is Bunny Storage. A standalone script is the pull zone's origin and reads files through the Storage API. The two differ in how they are entered and how a stored file is reached, but routing, headers and caching must behave the same in both.

## Considered options

- **Two separate handlers**, each with its own routing. Every routing rule is written and tested twice, and the copies drift.
- **One handler with branches on the script type.** One copy, but routing is tangled with bunny.net hooks, so it is only testable on a runtime.
- **One pure decision function returning data, interpreted by each script type.**

## Decision outcome

The third. `routing.decide` returns a decision: render, redirect, or a stored file with what to do when storage has no such file. Route matching is a callback, backed by Astro's `app.match()` at runtime and by a table in tests, so Astro's route priority is never reimplemented.

- **Middleware** turns a file decision into a rewritten origin request, and handles the fallback in `onOriginResponse` on a storage 404. The visitor's path travels between the two hooks as the reserved query parameter `__bunny_path` on the rewritten URL, which the response hook sees and storage ignores (measured on bunny.net on 2026-10-28 and 2026-11-03).
- **Standalone** reads the file through the Storage API itself, and handles the fallback on a 404.
- **The visitor URL** is rebuilt from the `cdn-host` header over `https`, never from `x-forwarded-host`, which a client controls (measured on bunny.net on 2026-10-16).
- **`script` defaults to `"middleware"`**, and the build logs the chosen type in one line. Middleware reads storage replicas; standalone reads the main region only.
- **A script type is fixed** once the Edge Script exists: on 2026-10-28, `POST /compute/script/{id}` with a different `ScriptType` answered 200 and changed nothing, in both directions.

### Consequences

- Good: routing is a table test with no runtime, no Astro build and no network.
- Good: a third way to run, `astro preview`, is one more interpreter, not a third copy of routing.
- Bad: the `match` callback hides how `app.match()` treats prerendered dynamic routes, so tests against a real build have to pin that down.

### Confirmation

`decide` has table tests. The same requests run through both script types against a built test app, under Deno with a stand-in for the pull zone.
