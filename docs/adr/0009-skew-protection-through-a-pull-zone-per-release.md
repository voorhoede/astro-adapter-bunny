---
status: proposed; open (the visitor's host behind a slot, the cache key with only a header, cost per slot)
date: 2026-11-18
---

# Skew protection through a pull zone per kept release

## Context and problem statement

A visitor who has a page of release A open keeps asking for what that page refers to after release B is live: assets with a content hash that load late (a `client:visible` island, a chunk loaded with `import()`), server islands, actions, prefetch and view transitions. Each release is stored in its own folder, `deploys/<id>`, and an edge rule points the pull zone at the newest one. A request for one of A's hashed assets then reaches `deploys/B`, where the file does not exist, and answers 404. The pull zone has one middleware script, so A's server islands and actions run B's code. A fixed `ASTRO_KEY` keeps island props readable across releases, but a renamed island or action still breaks.

Astro lets an adapter tag these requests: `client.assetQueryParams` is appended to every asset URL, for example `?dpl=<id>`, and `client.internalFetchHeaders` is sent with island, action and prefetch requests, for example `x-deployment-id: <id>`. Vercel uses the same two to route a tagged request to the deployment that served the page, for both assets and functions, up to a configurable maximum age. Cloudflare documents version affinity for gradual deployments, and that a Worker version serves only its own assets; Next.js on Cloudflare pins requests through the preview URL of each kept version (read on 2026-11-18).

bunny.net keeps every script deployment for rollback, but runs one at a time, and documents no per-version URL or pinning (read on 2026-11-18). A pull zone has one middleware script. Edge rules can trigger on the URL query string (trigger type 6) and on a request header (trigger type 1).

Measured on bunny.net on 2026-11-18, with release A in `deploys/A` and B in `deploys/B` of one storage zone, B's script on the main pull zone, and A's script on a second pull zone ("slot") on the same storage zone, serving `deploys/A`:

- Without a rule, A's stylesheet answered 404 on the main pull zone, and 200 on the slot.
- A rule on the main pull zone with the action "Origin URL" (2) pointing at the slot changed nothing while the rule that serves `deploys/B` from storage (action 17) also matched.
- A rule with "Origin Storage" (17) on `deploys/A` and "Run Edge Script" (21) with A's script served A's assets, but B's script still answered: the action did not replace the pull zone's middleware script.
- With the `deploys/B` rule excluding requests for A (trigger type 6 and 1 with "match none"), and a rule for A with "Origin URL" to the slot, a GET with `?dpl=A` or `x-deployment-id: A` answered A's code and A's stylesheet. B's script forwarded the request to storage, which was now the slot.
- A POST with `x-deployment-id: A` answered B's code: B's script renders methods other than GET and HEAD itself, so the request never reached the slot.
- Behind the main pull zone, A's script saw the slot's hostname, so `Astro.url` named the slot instead of the visitor's host.
- The main pull zone's cache key ignored the query string (`QueryStringVaryParameters` empty): a second GET on A's endpoint answered the body of the first. B's script also gave the slot's response `public, max-age=0, must-revalidate`, replacing the `private, no-store` A's script had set.

## Considered options

- **Do nothing, and document it.** After every deploy, a page that is open loses its late assets and islands until it reloads.
- **Keep old assets only.** One shared `_astro/` folder for all releases, or a rule per release that serves `deploys/<id>` for `?dpl=<id>`. Fixes assets, not islands and actions, which still run the newest script.
- **Pin the whole release, as Vercel does.** Assets and code of a kept release keep answering requests tagged with its id.

## Decision outcome

Pin the whole release. A kept release gets its own pull zone and middleware script on the shared storage zone, serving its own deploy folder. The main pull zone sends every request tagged with that release's id to it, and serves the newest release otherwise.

- **The build is tagged.** The adapter reads a release id from the build's environment and sets `client.assetQueryParams` to `dpl=<id>` and `client.internalFetchHeaders` to `x-deployment-id: <id>`.
- **The script knows its own release.** A request tagged with another release's id goes to the origin unchanged, for every method, and its response passes through without the headers the script gives stored files.
- **The visitor's host travels along.** The forwarding script passes the visitor's host to the slot in a header, and the slot's script builds the visitor's request from it.
- **The cache key varies on `dpl`.** The main pull zone sets `QueryStringVaryParameters` to `dpl`.
- **The deploy tool owns the slots.** It moves the previous release into a slot on every deploy, adds a rule per kept release with "Origin URL" to its slot, excludes the kept ids from the rule that serves the newest release, and drops the oldest slot past the maximum.

### Consequences

- Good: a page that is open keeps its assets, islands and actions working after a deploy, up to the number of kept releases.
- Good: the adapter's part is small: a release id, two Astro options, forwarding in the script, and the visitor's host.
- Bad: every kept release costs a pull zone, a script, its script variables (at most 128 per script), and an edge rule from the 50 a pull zone takes. The rule that serves the newest release excludes each kept id, at most 5 patterns per trigger.
- Bad: a request tagged only by the header, without `dpl`, shares the cache key of the newest release.
- Bad: a tagged request goes through two pull zones and two script runs.
- Bad: a request for a release past the maximum answers from the newest release, as an untagged one does.

### Confirmation

Open. Before this is accepted: on bunny.net, a page of an older release loads a late asset, renders a server island and posts an action with that release's code, the island and action see the visitor's host, and a tagged and an untagged GET on the same path do not share a cached response.
