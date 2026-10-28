---
status: accepted (Cloudflare semantics, stored files only, `headers` option removed, precedence, no `Cache-Control` from `_headers`, `_redirects` only for paths no on-demand route claims, static builds through the deploy tool); proposed (the rest)
date: 2026-10-28
---

# `_headers` and `_redirects` for stored files, with Cloudflare's semantics

## Context and problem statement

Stored files never pass Astro middleware, so a security baseline on them needs the adapter (R-HDR-1). The reference site passes it today as a `headers` option. bunny.net's docs never mention `_headers` or `_redirects` (searched 2026-10-28), so they are not a platform feature; the bunny-edge-deploy Action already turns them into edge rules for static builds (read in its code, not run live). A static build has no script, so an option cannot reach it at all.

## Considered options

- **A `headers` option, applied by the script.** Static builds get nothing; one more option.
- **`headers` option plus `public/_headers`.** Two inputs for the same thing, merged with a precedence rule.
- **Only `public/_headers` and `public/_redirects`, with Cloudflare's semantics.** One input, portable, and the same file for script and static builds.

## Decision outcome (accepted)

The third, and the `headers` option is removed.

- **Semantics.** Cloudflare's documented `_headers` and `_redirects` semantics. They apply only to stored (static) files. Rendered responses own their headers, set in Astro middleware.
- **Redirects.** `_redirects` covers paths no on-demand route claims (decision table row 8). A redirect from a path a dynamic route answers goes in Astro's own `redirects` config.
- **Precedence.** What Astro sets per page (`staticHeaders`, `routeToHeaders`) beats `_headers`, which fills only missing headers. The adapter never overwrites a header on a rendered response (ADR 0005 has the two exceptions). `_headers` cannot set `Cache-Control` on stored files, since `caching` owns it.
- **Script builds.** The build parses both files into data in the eager script; the script applies them to stored files and answers 404 for `/_headers` and `/_redirects`.
- **Static builds.** The files stay in `dist/client` and the deploy tool turns them into edge rules. If they do not fit the 50-rule limit, the deploy fails with a clear message; the adapter warns at build when the count exceeds 50.
- **The reference site** moves its baseline into `public/_headers` with a `/*` block. It loses `frame-ancestors` on prerendered pages, since Astro's per-page CSP wins over the CSP it set through `headers`, and must re-add it in Astro's CSP config.

Proposed details, each pinned by a unit test in M1 against Cloudflare's docs: path matching (splats, placeholders), several matching `_headers` blocks combining, `! Name` detaching a header, redirect statuses, status 200 serving another stored file, and whether the visitor's query is kept. A syntax error in either file fails the build with the line number.

### Consequences

- Good: one input for script and static builds; the file works on other hosts too.
- Good: two options instead of three, and no runtime parser.
- Bad: the reference site can no longer feed adapter and middleware from one TypeScript module without writing the file.
- Bad: a static build gets only what the deploy tool can express as edge rules (no placeholders or mid-path splats in the Action today); script and static builds can differ for those rules.
- Bad: the header table grows with every distinct per-page CSP **[open: L1 step 2, how many distinct CSPs `routeToHeaders` holds and whether `404.html` is in it]**.

### Confirmation

M1 tests rule matching and precedence as tables. M2 builds the test app with both files and checks the parsed table, the warning above 50 rules, and that the files are copied unchanged in a static build. M4 and M5 check over HTTP that `_headers` lands on stored files and not on rendered ones, that `/` keeps exactly one CSP, and that `/_headers` and `/_redirects` answer 404. L2 step 5 runs the Action's parser on the test app's files.
