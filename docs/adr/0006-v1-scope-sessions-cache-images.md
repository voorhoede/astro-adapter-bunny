---
status: accepted (the image service mechanism, the default cache provider); proposed (the rest)
date: 2026-10-28, updated 2026-10-30
---

# Version 1 scope: sessions, cache provider and image service

## Context and problem statement

Official adapters ship a default session driver, some a CDN cache provider, and a runtime image endpoint. The reference site needs none of these: sessions off, no `Astro.cache`, and images built from a headless CMS with the no-op service. Each has open platform questions on bunny.net.

## Considered options

For each: ship in version 1, or leave out with a clear path.

## Decision outcome

- **Sessions: left out.** The adapter honors Astro's config and injects no default driver; users pick an unstorage driver that works over HTTP. Bunny Storage is weak as a session store (main region only, no conditional write, no expiry); Bunny Database is not researched. A driver is a later piece of work.
- **Cache provider: in.** A default bunny.net CDN provider, registered when the project has none. Astro keeps a provider's headers through `app.render()` (verified locally with Astro 7.4.2).
- **Image service: Sharp at build only.** When the project uses the default Sharp service, the adapter sets `image.service` to `{ build: sharp, runtime: noop }` with Astro 7.4's split, so prerendered images are still optimized and the Sharp library is absent from the server output (verified in an Astro 7.4.2 build). On-demand images are served untransformed. A project's own service, or its own split, is left alone. No Bunny Optimizer service: whether Optimizer transforms script or middleware responses is not known.

### Consequences

- Good: no option for any of these.
- Good: nothing in version 1 calls a service beyond storage and, for `invalidate()`, the bunny.net API.
- Bad: a user enabling sessions must bring a driver, and Astro errors at build without one.
- Bad: `<Image>` on on-demand pages is not optimized.

### Confirmation

A test app builds with `session: false` and no driver, and `sharp` does not appear in the script. The README lists each limit.
