---
status: accepted
date: 2026-11-18, rewritten 2026-11-19 and 2026-11-24
---

# No skew protection, for now

## Context and problem statement

A visitor who has a page of release A open keeps asking for what that page refers to after release B is live: assets with a content hash that load late (a `client:visible` island, a chunk loaded with `import()`), server islands, actions, prefetch and view transitions. Each release has its own storage zone and script, and a pull zone points at one release. Once it points at B, a request for one of A's hashed assets reaches B's storage zone, where the file does not exist, and answers 404, and A's server islands and actions run B's code. A fixed `ASTRO_KEY` keeps island props readable across releases, but a renamed island or action still breaks.

Astro lets an adapter tag these requests: `client.assetQueryParams` is appended to every asset URL, for example `?dpl=<id>`, and `client.internalFetchHeaders` is sent with island, action and prefetch requests, for example `x-deployment-id: <id>`. Vercel uses the same two to route a tagged request to the deployment that served the page, and never pins a full page navigation (read on 2026-11-18). bunny.net's own Astro adapter has no skew protection (read on 2026-11-18).

A pull zone has one middleware script, and a hostname belongs to one pull zone. Measured on bunny.net on 2026-11-18 and 2026-11-19, with both releases in folders of one storage zone and A's script on a pull zone of its own:

- An edge rule on B's pull zone with "Origin URL" to A's pull zone, on the query string or the request header, answered a tagged asset, server island and action with A's code and files, once B's script passed tagged requests on for every method and left their responses alone.
- A's script saw its own pull zone's hostname, so `Astro.url` named it and Astro's origin check refused an action from the visitor's page with 403. A header with the visitor's host, trusted only next to a secret held in A's script, fixed both.
- The cache key had to include `dpl`, and A's pull zone needed the cache settings of B's, or one response answered every query.
- A plain HTML form post carries no header and answered from B.

Measured on 2026-11-23: an edge rule with "Origin Storage" and another storage zone's id served that zone's file.

## Considered options

- **Pin the whole release, as Vercel does.** Every kept release keeps a pull zone of its own, the newest release's pull zone forwards tagged requests to it, and the script trusts a forwarded host next to a secret per release. Assets, islands and actions of an open page keep working, at the cost of a pull zone per kept release, an edge rule each, two script runs per tagged request, and a forwarded host and secret the script has to handle on every request.
- **Keep old assets only.** Tag asset URLs, and send a tagged asset to its release's storage zone with an "Origin Storage" rule. Late assets keep loading, without a pull zone per release or a forwarded host, but islands and actions still run the newest script.
- **Do nothing.**

## Decision outcome

Do nothing, for now. The adapter does not tag asset URLs or Astro's fetches, and the script handles no deploy id, forwarded host or secret. It takes the visitor's host from `Host` only.

### Consequences

- Good: the script has no deploy id, forwarded host or secret to handle, and a request means the same to every release.
- Good: a release needs no pull zone of its own and no edge rules to stay reachable.
- Bad: after a deploy, a page that is open answers 404 for late assets, and its server islands and actions run the new release, until the visitor reloads.
- Bad: adding it later means tagging the build again and choosing between the two other options, with the "Origin URL" and "Origin Storage" rules untested next to a pull zone whose origin is a release's storage zone.

### Confirmation

A build has no `?dpl=` on its asset URLs and sends no `x-deployment-id`, and a request with `x-forwarded-host` keeps the real host in `Astro.url`.
