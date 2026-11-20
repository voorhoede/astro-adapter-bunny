---
status: accepted
date: 2026-11-20
---

# Preview runs the script under Deno

## Context and problem statement

`astro preview` loads an adapter's `previewEntrypoint` in Node. The script bundles the Deno variant of the edge script SDK, since bunny.net runs Deno. Outside bunny.net that variant serves the pull zone itself: under Deno through `Deno.serve`, on `127.0.0.1:8080`, with `https://bunny.net` as origin when the script names none. Under Node it fails, since its Node branch calls `undefined`. With a `Bunny` global defined, it hands its hook lists to `Bunny.v1.registerMiddlewares` instead of serving them. The pull zone it serves locally is `internal_buildPullZoneHandler`, which the package also exports: it runs the hooks around a fetch to the origin URL it is given.

Measured locally on 2026-11-20 with the test app, its script run by the SDK under Deno 2.9:

- Stored files, prerendered pages, on-demand routes, redirects, late files, the 404 page and a 405 for a POST to a stored file answered as on bunny.net, with origin requests answered from `dist/client`.
- `Astro.url` lost its port and became https, so a same-origin POST answered 403. bunny.net sets `x-forwarded-proto` and `x-real-ip`; the SDK sets neither, and `Astro.clientAddress` answered 500.
- The script dropped every port from the visitor's URL, also one in `host`, because it cleared the port after setting the host.
- `astro preview stop` ended the Node process but left Deno running on the port.

## Considered options

- **Node, with the SDK's pull zone handler.** A small `Bunny` global hands the hooks to `internal_buildPullZoneHandler`, which Node can import. No Deno needed, but the script runs on another runtime than on bunny.net, and the handler is internal to the SDK.
- **The script under Deno, in a subprocess, on the SDK's own fallback.** The script runs as built, but serves on `127.0.0.1:8080` with `https://bunny.net` as origin, so `Deno.serve` and `fetch` have to be patched to move it.
- **The script under Deno, in a subprocess, with its hooks handed to the SDK's handler.** The script runs as built, on the runtime bunny.net uses. A `Bunny` global collects its hooks, and the SDK's handler from `node_modules` serves them with an origin and address of our choosing. Needs Deno installed.
- **No preview.** A deploy serves as the preview.

## Decision outcome

The script under Deno, with its hooks handed to the SDK's handler. `preview.ts` starts `run-script.ts` with Deno and resolves once it listens. `run-script.ts`:

- serves a stand-in for the storage zone from `dist/client` on a free local port: a folder answers its `index.html`, and a missing file `404.html` with 404,
- defines `Bunny.v1.registerMiddlewares`, which keeps the script's hooks, and `Bunny.v1.waitUntil`, before it loads the script,
- passes the hooks and the stand-in's URL to `internal_buildPullZoneHandler` from the SDK in `node_modules`, and serves that on the host and port Astro asks for,
- sets `x-forwarded-proto: http` and `x-real-ip` to the client's address on every request,
- exits when its stdin closes, which happens when the Node process ends, however it ends.

The script clears the port before it sets the host, so a port in `host` stays in `Astro.url`.

Only server output gets a preview entrypoint; without a script Astro serves the files itself.

### Consequences

- Good: the script that gets deployed is the one that runs, on the same runtime.
- Good: nothing global is patched besides the `Bunny` global bunny.net also provides, so the site's own fetches go where they point.
- Bad: the preview calls an SDK function marked internal, which a new SDK version may change.
- Bad: the script carries the SDK it was built with, and the handler comes from the installed one. Built and previewed from the same install they match.
- Bad: `astro preview` needs Deno.
- Bad: the stand-in for storage gives a fixed set of extensions their type; real storage may differ for others, which the script then types itself.
- Bad: a static site with a `server:defer` island gets Astro's static preview, without its script.
- Bad: `server.headers` and `server.allowedHosts` are ignored.

### Confirmation

With the test app on 2026-11-20, with the hooks handed to the SDK's handler, `astro preview` served stored files with their type, on-demand routes, redirects, the 404 and 500 pages, a same-origin POST with 200 and a cross-site POST with 403, `Astro.url` as `http://localhost:4321`, and `Astro.clientAddress`. `--port 4400` was used. `astro preview stop` stopped Deno too, and without Deno on the path the log said to install it.
