---
status: accepted
date: 2026-10-28, rewritten 2026-11-10 and 2026-11-18
---

# Sessions and images

## Context and problem statement

Official adapters ship a default session driver and a runtime image endpoint. bunny.net Edge Scripts cannot run native binaries, so Sharp cannot transform images at runtime, and with Sharp in the server bundle the script imported `node:child_process`. Bunny Storage is weak as a session store: main region only, no conditional write, no expiry. Bunny Optimizer was reported to answer 523 on pull zones with a script as origin (August 2026).

Astro 7.4 can split the image service into one for the build and one for runtime. Astro's no-op service links `<Image>` to `/_image`, whose endpoint answers the original file. The Cloudflare adapter offers an `imageService` option with `compile` (the configured service at build, no-op at runtime), `passthrough` (no-op everywhere) and `custom` (the configured service everywhere), among values for its own image services.

## Considered options

For each: ship it, or leave it out with a clear path.

## Decision outcome

- **Sessions: left out.** The adapter injects no default driver; a site that enables sessions brings an unstorage driver that works over HTTP.
- **Images: an `imageService` option with `compile`, `passthrough` and `custom`**, as Cloudflare names them. `compile` is the default: the project's service at build, Sharp unless it set one, and Astro's no-op service at runtime. Prerendered pages get optimized images; `<Image>` on an on-demand page gets the original through `/_image`.
- **No Bunny Optimizer service.**

### Consequences

- Good: with `compile` and `passthrough`, Sharp stays out of the script.
- Bad: a site that enables sessions must bring a driver.
- Bad: `<Image>` on on-demand pages is not optimized, and `/_image` answered with `content-type: image/undefined` (2026-11-09).
- Good: a project keeps its own build service, and `custom` keeps its runtime service too.
- Good: a later runtime service, such as an image CDN, is one more value of the option; sites do not change.
- Bad: `custom` bundles the project's runtime service without a check. With Sharp the script held `child_process`, and a script that imports it answers 400 on every request.

### Confirmation

The test app's prerendered image is a WebP from Sharp, the script holds no Sharp, and the on-demand image answers 200 with the original file. Built on 2026-11-18: `compile` gave a WebP and a script without Sharp, `passthrough` the original PNG and a script without Sharp, and `custom` a WebP and a script with Sharp and `child_process`.
