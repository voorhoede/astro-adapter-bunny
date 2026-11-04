---
status: accepted
date: 2026-10-28, updated 2026-11-04
---

# Sessions and images in version 1

## Context and problem statement

Official adapters ship a default session driver and a runtime image endpoint. The reference site needs neither: sessions are off, and its images are built from a headless CMS with the no-op service. Both have open platform questions on bunny.net.

## Considered options

For each: ship in version 1, or leave out with a clear path.

## Decision outcome

- **Sessions: left out.** The adapter honors Astro's config and injects no default driver; users bring an unstorage driver that works over HTTP. Bunny Storage is weak as a session store (main region only, no conditional write, no expiry), and Bunny Database is not researched.
- **Images: Sharp at build only.** The `imageService` option defaults to `'compile'`: when the project uses the default Sharp service, the adapter sets `image.service` to `{ build: sharp, runtime: noop }` with Astro 7.4's split, so prerendered images are still optimized and Sharp is absent from the server output (verified in an Astro 7.4.2 build). On-demand images are served untransformed. `'passthrough'` leaves every image untransformed, and `'custom'` keeps the project's own image config.
- **No Bunny Optimizer service**, since whether Optimizer transforms responses from a script is not known.

### Consequences

- Good: nothing beyond storage and, for `invalidate()`, the bunny.net API is called at runtime.
- Bad: a site that enables sessions must bring a driver, and Astro errors at build without one.
- Bad: `<Image>` on on-demand pages is not optimized.

### Confirmation

The test app's build optimizes its images with Sharp, and `sharp` does not appear in the script.
