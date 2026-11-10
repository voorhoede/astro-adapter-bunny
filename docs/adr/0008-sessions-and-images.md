---
status: accepted
date: 2026-10-28, rewritten 2026-11-10
---

# Sessions and images

## Context and problem statement

Official adapters ship a default session driver and a runtime image endpoint. bunny.net Edge Scripts cannot run native binaries, so Sharp cannot transform images at runtime, and with Sharp in the server bundle the script imported `node:child_process`. Bunny Storage is weak as a session store: main region only, no conditional write, no expiry. Bunny Optimizer was reported to answer 523 on pull zones with a script as origin (August 2026).

Astro 7.4 can split the image service into one for the build and one for runtime.

## Considered options

For each: ship it, or leave it out with a clear path.

## Decision outcome

- **Sessions: left out.** The adapter injects no default driver; a site that enables sessions brings an unstorage driver that works over HTTP.
- **Images: Sharp at build only.** The adapter sets `image.service` to Sharp for the build and Astro's no-op service at runtime. Prerendered pages get optimized images; `<Image>` on an on-demand page gets the original through `/_image`.
- **No Bunny Optimizer service.**

### Consequences

- Good: Sharp stays out of the script.
- Bad: a site that enables sessions must bring a driver.
- Bad: `<Image>` on on-demand pages is not optimized, and `/_image` answered with `content-type: image/undefined` (2026-11-09).
- Bad: the adapter replaces a project's own `image.service`, so a custom service is lost.

### Confirmation

The test app's prerendered image is a WebP from Sharp, the script holds no Sharp, and the on-demand image answers 200 with the original file.
