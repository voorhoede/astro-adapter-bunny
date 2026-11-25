---
status: accepted
date: 2026-11-18, rewritten 2026-11-19, 2026-11-24 and 2026-11-25
---

# Skew protection through commit pull zones

## Context and problem statement

A visitor who has a page of release A open keeps asking for what that page refers to after release B is live: assets with a content hash that load late (a `client:visible` island, a chunk loaded with `import()`), server islands, actions and prefetch. Once a pull zone points at B, a request for one of A's hashed assets reaches B's storage zone, where the file does not exist, and answers 404, and A's server islands and actions run B's code. Astro encrypts a server island's props with a key made per build, so B cannot read A's props and the island answers 400, unless every build gets the same `ASTRO_KEY` by hand.

Every release has a commit pull zone of its own, `{site}-{hash}.b-cdn.net`, that keeps serving it until the release is deleted.

Astro lets an adapter tag these requests: `client.assetQueryParams` is appended to asset and chunk URLs, and `client.internalFetchHeaders` is sent with server island, action and prefetch requests. Netlify and Vercel use them to send a tagged request to the deploy that served the page. Astro's Cloudflare adapter does not use them, and Cloudflare has no deploy pinning of its own (read on 2026-11-25).

A release's script that answers a request another release forwarded sees its own pull zone's hostname and an edge server's address. bunny.net overwrites `x-real-ip` and `x-forwarded-for` with the address of whoever called the pull zone, so the visitor's host and address have to travel in headers the receiving script can trust.

Measured on bunny.net on 2026-11-18 and 2026-11-19, with an edge rule forwarding to another pull zone: the cache key had to include the tag, or one response answered every release; and a plain HTML form post carries no header.

## Considered options

- **A fixed `ASTRO_KEY` set by hand for every build.** Islands keep reading their props, but a renamed island or action still breaks, late assets still answer 404, and every site has to keep a secret.
- **A fixed key the adapter derives or stores.** Derived from the API key, it needs that key at build time; committed to the repository, anyone who can read it can read and forge props; stored at bunny.net, the build has to call bunny.net.
- **Forwarding with an edge rule per kept release.** No script work, but a rule per release against 50 rules per pull zone, and no way to pass the visitor's host and address that the receiving script can trust.
- **Forwarding in the script to the commit pull zone, trusting a host allowlist.** No secret, but an allowlist cannot vouch for the visitor's address, and a pattern such as `{site}-*.b-cdn.net` can be claimed by any account, since `b-cdn.net` names are first come.
- **Forwarding in the script to the commit pull zone, trusting a shared secret.**

## Decision outcome

**Tag.** A build with a script tags its requests with the first seven characters of the commit it builds: `x-bunny-release: <release>` on server island, action and prefetch requests, and `?dpl=<release>` on asset URLs. The commit comes from `BUNNY_COMMIT`, else `GITHUB_SHA`, else the checkout's `HEAD`, and the build manifest records it, so the deploy names the release after the same commit. A build outside a git checkout is not tagged.

**Forward.** A release's script that gets a request tagged with another release sends it to that release's commit pull zone, with the visitor's host, protocol and address in `x-bunny-forwarded-*` headers and the site's secret in `x-bunny-forward-secret`. A response chosen by the header gets `Cache-Control: private, no-store`, since the cache key holds the query but not the header. When the commit pull zone no longer exists, bunny.net answers without a `CDN-PullZone` header, and the release handles the request itself.

**Trust.** A script uses the forwarded host, protocol and address only when the secret matches its own, and removes those headers before the site's code sees the request. The deploy sets the site's name and the secret on every script; the secret is an HMAC-SHA256 of the site's name keyed with the account's API key, so nobody keeps it and the key cannot be read back from it.

A static site has no script and is not tagged.

### Consequences

- Good: an open page's late assets, server islands, actions and prefetches keep running the release that served the page, for as long as that release is kept, with no key to set by hand.
- Good: no edge rule per release, and the visitor's host, protocol and address stay right in the release that answers.
- Bad: a tagged request for an older release runs two scripts and two pull zones.
- Bad: a release that is deleted no longer answers, so its open pages fall back to the newest release, and its islands answer 400.
- Bad: replacing the account's API key gives new releases another secret, so older releases stop trusting what newer ones forward, and then see the forwarding pull zone's host and address, until they are deleted.
- Bad: a plain HTML form post carries no header and runs the newest release.
- Bad: a static site's late assets still answer 404 after a switch.

### Confirmation

After a switch from release A to release B, a server island request from A's page with A's header answers with A's island, on the branch's host and with the visitor's address; the same request without the header answers from B; an asset URL with A's `?dpl=` answers A's file; a request whose `x-bunny-forward-secret` does not match keeps the commit pull zone's host; and a tag of a deleted release is answered by B.
