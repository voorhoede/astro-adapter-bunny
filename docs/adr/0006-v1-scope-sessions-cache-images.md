---
status: accepted (the image service mechanism); proposed (the rest)
date: 2026-10-28
---

# Version 1 scope: sessions, cache provider and image service

## Context and problem statement

Official adapters ship a default session driver, some an experimental CDN cache provider, and a runtime image endpoint. The reference site needs none of these: sessions off, no `Astro.cache`, images built against a headless CMS with the no-op service (R-ENV-4, R-IMG-1). Each has open platform questions on Bunny.

## Considered options

For each: ship in v1, or leave out with a clear path.

## Decision outcome

Leave all three out of v1, each behind Astro's own extension point so adding one later is additive.

- **Sessions.** Honor Astro's config; inject no default driver. Users pick an unstorage driver that works over HTTP. Bunny Storage is weak as a store (main region only, no conditional write, no TTL); Bunny Database is unresearched. A driver is its own later milestone after a spike (bunny research open question 7).
- **Cache provider.** A default bunny.net CDN provider (ADR 0005). Astro keeps a CDN provider's headers through `app.render()` (verified locally); whether a script's `CDN-Tag` is honored for tag purges is open for a bunny.net check.
- **Image service.** `sharpImageService: limited`: Sharp transforms prerendered images at build; on-demand images are served untransformed. Mechanism (accepted): when the project uses the default Sharp service, the adapter sets `image.service` to `{ build: sharp, runtime: noop }` with Astro 7.4's split, so images are still optimized at build and the Sharp library is absent from the server output (L1 step 4). A project's own service, or its own split, is left alone. No Bunny Optimizer service: whether Optimizer transforms script or middleware responses is open (bunny research open question 4).

### Consequences

- Good: v1 has no option for any of these.
- Good: nothing in v1 calls a service beyond storage (the reference site's rule on third-party processors).
- Bad: a user enabling sessions must bring a driver, and Astro errors at build without one.
- Bad: `<Image>` on on-demand pages is not optimized.

### Confirmation

M2 builds a test app with `session: false` and no driver, and checks that `sharp` is absent from the script, packed chunks included; the README lists each limit.
