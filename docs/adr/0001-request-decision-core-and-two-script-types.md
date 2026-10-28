---
status: accepted (both script types, default middleware); proposed (the rest)
date: 2026-10-28
---

# One pure request decision, two thin script types

## Context and problem statement

The adapter must run as a standalone script (the pull zone origin, reading files through the Storage API) and as middleware (in front of a storage-origin pull zone). The reference site runs middleware; the open source adapter needs both (R-TYPE-1 to R-TYPE-4, G-1). The two differ in how they are entered and how a stored file is reached; routing, headers and caching must behave the same. Routing is where the reference site's known bug lives: a catch-all `[locale]` route claims `/sitemap-index.xml`.

## Considered options

- **Two separate handlers**, each with its own routing. Simple to start, but every routing rule is written and tested twice and drifts.
- **One handler with branches on script type.** One copy, but routing is tangled with Bunny hooks, so it is only testable on a runtime.
- **One pure decision function returning data, interpreted by two thin script modules.**

## Decision outcome

The third. `routing.decide(request, site, match)` returns a `Decision`: `render`, `redirect`, or `file` with a storage key, an optional status and an `otherwise` decision for when storage has no such file. Route matching is a callback, backed by Astro's `app.match()` at runtime and by a table in tests, so Astro's priority rules are never reimplemented.

- `scripts/middleware` interprets `file` as a rewritten origin request and `otherwise` in `onOriginResponse` on a storage 404.
- `scripts/standalone` interprets `file` as a Storage API read and `otherwise` on a 404.
- Both rebuild the visitor URL from `cdn-host` and `https` through `platform`, never from `x-forwarded-host`, which a client controls (measured in the prototype, 2026-10-16).
- **Accepted:** both script types ship; `script` defaults to `"middleware"`, and the build logs the chosen type in one line. Middleware reads storage replicas, standalone reads the main region only.
- A script type is fixed once the Edge Script exists: the deploy tool refuses a mismatch (read in its code). Whether Bunny itself refuses a change of `ScriptType` is unchecked; S1 step 10 tries it on a throwaway script. Only the README sentence depends on the answer.

### Consequences

- Good: routing is a table test with no runtime, no Astro build and no network.
- Good: a third way to run (a local preview server) is one more interpreter, not a third copy of routing.
- Bad: middleware must carry the visitor path from `onOriginRequest` to `onOriginResponse`. Proposed: a reserved query parameter on the rewritten URL, since the hook is measured to see the rewritten URL, with a request header as fallback. S1 step 4 checks that storage ignores the query and that the cache key stays the visitor URL.
- Bad: the `match` callback is an abstraction over `app.match()` whose exact semantics (prerendered dynamic routes falling back) must be pinned by tests against a real build.

### Confirmation

M1 ships `decide` with table tests, including `/sitemap-index.xml` under a `[locale]` route. M4 and M5 run the same requests through both script types (`docs/testing.md`).
