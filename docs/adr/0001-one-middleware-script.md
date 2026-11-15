---
status: accepted; open (shielding the storage zone)
date: 2026-10-28, rewritten 2026-11-15
---

# One middleware script in front of the storage zone

## Context and problem statement

A bunny.net Edge Script is either a standalone script, which is the pull zone's origin and reads stored files through the Storage API, or a middleware script, which runs in front of a pull zone whose origin is the storage zone. A script keeps the type it was created with: on 2026-10-28, `POST /compute/script/{id}` with a different `ScriptType` answered 200 and changed nothing, in both directions.

Measured on bunny.net between 2026-11-09 and 2026-11-10, with a storage zone in Falkenstein:

- A standalone script reads from the Storage API's main region only, and needs the zone name and password as script variables. A middleware script needs neither: the pull zone fetches stored files itself, from replicas too.
- A request for a byte range of a 5 MB stored file answered 206 with the right 100 bytes through a middleware script, also on a cache miss. The standalone script answered 200 with the whole file, since it did not pass `Range` on to storage.
- The hooks of a middleware script see the origin's URL (`http://storage.bunnycdn.com:9000/...`), not the visitor's. The visitor's host arrives in `host` and `cdn-host`, the protocol in `x-forwarded-proto`. bunny.net overwrites `x-forwarded-proto`: a client sending `https` over http, or `http` over https, still got the real protocol. A standalone script gets the visitor's host, but `https` for every visitor, and `x-forwarded-proto` as a repeated list such as `http, http`.
- A POST without a route sent its body to storage. When storage answered 404, rendering Astro's 404 page with that request threw, since its body was already read, and the visitor got an empty 500.
- A POST passed on unchanged got 404 from storage for a missing path and 405 for a stored file. In the response hook the request had `bodyUsed` set, and reading it threw `Body already consumed` (2026-11-13).
- bunny.net overwrites `x-real-ip` and `x-forwarded-for` with the visitor's address: a client sending `x-real-ip: 6.6.6.6` and `x-forwarded-for: 7.7.7.7` still arrived with its own address in both, while a header bunny.net does not set, such as `cf-connecting-ip`, passed through (2026-11-15).

## Considered options

- **Both script types, chosen by an option.** Twice the testing, and a storage key in every standalone deploy.
- **Only standalone.** Works with bunny.net's own CLI, but reads only the main region and answered byte ranges with the whole file.
- **Only middleware.**

## Decision outcome

Only middleware. `bunny()` takes no options, and `src/script.ts` registers two hooks through `@bunny.net/edgescript-sdk`:

- **A deploy folder** that an edge rule puts in front of the path, named in `X-Bunny-Deploy`, is stripped before anything else and added back for storage.
- **A path in the wrong trailing slash form** is rendered by Astro, which redirects it, before storage is asked.
- **A redirect route** is rendered by Astro, which answers 301 or 308.
- **A GET or HEAD** goes to the pull zone, so storage is asked first. A 404 from storage is rendered by Astro in the response hook: the on-demand route if one matches, otherwise its own 404 page.
- **Any other method** is rendered by Astro in the request hook when an on-demand route matches, since the pull zone consumes the body on its way to storage. On a stored file or a prerendered route it answers 405 with `Allow: GET, HEAD`, as storage itself does. Any other path renders Astro's 404 page. No request body reaches storage.
- **The visitor's URL** is rebuilt before rendering: the host from `host`, the protocol from the first value of `x-forwarded-proto`, and no port. Without it, Astro's origin check refused every POST from a browser with 403, and `Astro.url` and absolute redirects pointed at storage.
- **Cookies** reach the visitor through `addCookieHeader: true`. Without it Astro left `Set-Cookie` out of the response.
- **The visitor's address** is passed as `clientAddress`, from `x-real-ip` or else the first value of `x-forwarded-for`. Without it `Astro.clientAddress` threw.

### Consequences

- Good: no storage key or region in the script, and replicas serve files.
- Good: one script type, so every check runs once.
- Bad: every file in the storage zone can be requested through the pull zone, not only the current build's.
- Bad: a project that wants bunny.net's own CLI flow, which creates standalone scripts, needs its own deploy step.

### Confirmation

On bunny.net, through a pull zone with the storage zone as origin: on-demand pages and endpoints render, stored files and prerendered pages come from storage, a missing path answers Astro's 404 page, a POST over http and over https passes the origin check while a cross-site POST answers 403, a POST to a stored file or prerendered page answers 405, `Astro.clientAddress` returns the visitor's address also when the client sends its own `x-real-ip`, and a byte range answers 206.
