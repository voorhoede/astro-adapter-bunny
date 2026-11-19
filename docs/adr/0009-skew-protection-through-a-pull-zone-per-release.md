---
status: proposed; open (the cache key with only a header, cost per kept release)
date: 2026-11-18, rewritten 2026-11-19
---

# Skew protection through a pull zone per release

## Context and problem statement

A visitor who has a page of release A open keeps asking for what that page refers to after release B is live: assets with a content hash that load late (a `client:visible` island, a chunk loaded with `import()`), server islands, actions, prefetch and view transitions. Each release is stored in its own folder, `deploys/<id>`, and an edge rule points the pull zone at the newest one. A request for one of A's hashed assets then reaches `deploys/B`, where the file does not exist, and answers 404. The pull zone has one middleware script, so A's server islands and actions run B's code. A fixed `ASTRO_KEY` keeps island props readable across releases, but a renamed island or action still breaks.

Astro lets an adapter tag these requests: `client.assetQueryParams` is appended to every asset URL, for example `?dpl=<id>`, and `client.internalFetchHeaders` is sent with island, action and prefetch requests, for example `x-deployment-id: <id>`. Vercel uses the same two to route a tagged request to the deployment that served the page, for assets and functions, up to a configurable maximum age, and never pins a full page navigation. On Vercel a domain is an alias of one deployment, and a tagged request bypasses the alias inside Vercel's own routing, so the request keeps the visitor's host (read on 2026-11-18). bunny.net's own Astro adapter has no skew protection (read on 2026-11-18).

bunny.net keeps every script deployment for rollback, but runs one at a time, and documents no per-version URL or pinning (read on 2026-11-18). A pull zone has one middleware script, and a hostname belongs to one pull zone. Edge rules can trigger on the URL query string (trigger type 6) and on a request header (trigger type 1).

Measured on bunny.net on 2026-11-18, with release A in `deploys/A` and B in `deploys/B` of one storage zone, B's script on the main pull zone, and A's script on a second pull zone on the same storage zone, serving `deploys/A`:

- Without a rule, A's stylesheet answered 404 on the main pull zone, and 200 on A's pull zone.
- A rule on the main pull zone with "Origin URL" (action 2) to A's pull zone changed nothing while the rule that serves `deploys/B` from storage (action 17) also matched.
- A rule with "Origin Storage" (17) on `deploys/A` and "Run Edge Script" (21) with A's script served A's assets, but B's script still answered: the action does not replace the pull zone's middleware script.
- With the `deploys/B` rule excluding requests for A (trigger types 6 and 1 with "match none") and a rule for A with "Origin URL" to A's pull zone, a GET with `?dpl=A` or `x-deployment-id: A` answered A's code and A's stylesheet, an untagged GET answered B, and A's stylesheet with `?dpl=A` answered 200 and then a cache hit, with `immutable`.
- A POST with `x-deployment-id: A` answered B's code until B's script passed a request tagged with another release to the origin for every method. Then it reached A.
- B's script gave A's response the headers of a stored file, replacing A's `private, no-store`, until it left those responses alone. A new pull zone also overrides cache-control for 30 days and ignores the query string by default, which served one rendered response for every query until A's pull zone matched the main one.
- The main pull zone's cache key ignored the query string (`QueryStringVaryParameters` empty), so a second GET on A's endpoint answered the body of the first. With `dpl` in `QueryStringVaryParameters` it did not.
- A's script saw its own pull zone's hostname, and bunny.net sent no `X-Forwarded-Host`. `Astro.url` named A's pull zone, and a form POST with the visitor's `Origin` answered 403 from Astro's origin check.
- "Forward Host Header" (`AddHostHeader`) on the main pull zone, whose origin is storage, was accepted by the API but stayed off. Setting `Host` to the main hostname on the rule to A's pull zone answered 508 Loop Detected for every tagged request.
- B's script set `x-forwarded-host` to the visitor's host, and the rule to A's pull zone set `x-bunny-forward-secret` to a value held only in A's script secret `BUNNY_FORWARD_SECRET`. A's `Astro.url` then named the main hostname, a tagged form POST with the main `Origin` passed the origin check, and one with another `Origin` answered 403. Directly on A's pull zone, a spoofed `x-forwarded-host` without the secret, or with a wrong one, was ignored. A page that echoes every request header did not show the secret.
- A script secret reads back empty from the API once set.

## Considered options

- **Do nothing, and document it.** After every deploy, a page that is open loses its late assets and islands until it reloads.
- **Keep old assets only.** One shared `_astro/` folder for all releases, or a rule per release that serves `deploys/<id>` for `?dpl=<id>`. Fixes assets, not islands and actions, which still run the newest script.
- **Pin the whole release, as Vercel does.** Assets and code of a kept release keep answering requests tagged with its id.

For the visitor's host behind a kept release:

- **Accept that a kept release sees its own hostname.** Its form posts and actions answer 403 until the visitor reloads.
- **Trust `X-Forwarded-Host` through Astro's `security.allowedDomains` or `site`.** Both are fixed at build, while one build serves as a preview on its own hostname and later as a kept release behind the site's hostname.
- **Let the forwarding script pass the host, and trust it only next to a secret per kept release.**

## Decision outcome

Pin the whole release, and pass the visitor's host with a secret per kept release.

- **The build is tagged.** With `BUNNY_DEPLOY_ID` set at build, the adapter sets `client.assetQueryParams` to `dpl=<id>` and `client.internalFetchHeaders` to `x-deployment-id: <id>`. Without it, nothing is tagged and the script behaves as before.
- **The script knows its own release.** A request tagged with another release's id goes to the origin for every method, with `x-forwarded-host` set to the visitor's host, and its response passes through unchanged.
- **The script trusts the forwarded host only with its secret.** With `BUNNY_FORWARD_SECRET` set and `x-bunny-forward-secret` equal to it, the visitor's request takes its host from `x-forwarded-host`. The secret header is removed before Astro sees the request.
- **The deploy tool owns the zones.** Every deployed commit gets its own pull zone and script on the shared storage zone, serving its own deploy folder, which also serves as its preview. A release moves the site's hostname to the newest commit's pull zone, with `dpl` in `QueryStringVaryParameters` and the cache settings of the previous one. That pull zone gets a rule per kept release with "Origin URL" to its pull zone and `x-bunny-forward-secret` as an extra action, and the rule that serves its own folder excludes the kept ids. The tool creates a random secret per kept pull zone, sets it as that script's secret and in that rule, and stores it nowhere else. Releases past the maximum lose their pull zone, and their secret with it.

### Consequences

- Good: a page that is open keeps its assets, islands, actions and form posts working after a deploy, up to the number of kept releases.
- Good: a plain deploy with the bunny.net CLI keeps working. Skew protection is an addition for a deploy tool that manages the zones.
- Good: the secret never reaches the browser or the page, and an open-source repository or its CI holds nothing beyond the API key the deploy already needs.
- Bad: every kept release costs a pull zone, a script, its script variables (at most 128 per script), and an edge rule from the 50 a pull zone takes. The rule that serves the newest release excludes each kept id, at most 5 patterns per trigger.
- Bad: a request tagged only by the header, without `dpl`, shares the cache key of the newest release. A site that caches island or action responses publicly can get the wrong release's response.
- Bad: a kept release's pull zone caches by URL only. A rendered response cached publicly there can hold the host of whichever request filled it.
- Bad: a tagged request goes through two pull zones and two script runs.
- Bad: a request for a release past the maximum answers from the newest release, as an untagged one does.

### Confirmation

Partly measured, as listed above. Before this is accepted: on bunny.net, a page of an older release loads a late asset, renders a server island and posts an action with that release's code, through a deploy tool that creates and removes the zones, rules and secrets.
