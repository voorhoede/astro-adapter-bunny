import type { BaseApp } from "astro/app";
import { RELEASE_HEADER } from "../../build/lib/adapter.ts";
import {
  FORWARD,
  replaceVisitorRequest,
  toVisitorRequest,
} from "./bunny-helpers.ts";

declare const process: { env: Record<string, string | undefined> };

/**
 * Sends a request an older page made to the release that served that page,
 * through the release's commit pull zone: an asset tagged `?dpl=<release>`,
 * or a server island, action or prefetch with the release header. Without it,
 * a late asset answers 404 and an island or action runs this release's code.
 * The deploy sets BUNNY_SITE and the shared BUNNY_FORWARD_SECRET on every
 * script, so the older release can trust the visitor's host and address.
 * Answers undefined to handle the request here: no tag, this release's tag,
 * or a release that no longer answers.
 */
export async function forwardToRelease(
  originRequest: Request,
  app: BaseApp,
): Promise<Response | undefined> {
  const own = app.manifest.internalFetchHeaders?.[RELEASE_HEADER];
  const site = process.env.BUNNY_SITE;
  const secret = process.env.BUNNY_FORWARD_SECRET;
  // A request another release forwarded is answered here, so a mistag never loops.
  if (!own || !site || !secret || originRequest.headers.has(FORWARD.secret)) {
    return undefined;
  }

  const request = toVisitorRequest(originRequest);
  const url = new URL(request.url);
  const fromHeader = request.headers.get(RELEASE_HEADER);
  const release = fromHeader ?? url.searchParams.get("dpl");
  if (!release || release === own || !/^[0-9a-f]{7}$/.test(release)) {
    return undefined;
  }

  const target = new URL(url);
  target.protocol = "https:";
  target.host = `${site}-${release}.b-cdn.net`;

  const headers = new Headers(request.headers);
  headers.set(FORWARD.secret, secret);
  headers.set(FORWARD.host, url.host);
  headers.set(FORWARD.proto, url.protocol.replace(":", ""));
  const address = originRequest.headers.get("x-real-ip");
  if (address) headers.set(FORWARD.address, address);

  // The body can be read once; a clone keeps it for this release when the older one no longer answers.
  const fallback = request.clone();
  let response: Response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });
  } catch {
    replaceVisitorRequest(originRequest, fallback);
    return undefined;
  }

  // A deleted release's pull zone no longer exists: bunny.net then answers 403 itself, without the CDN-PullZone header every pull zone sends.
  if (!response.headers.has("cdn-pullzone")) {
    await response.body?.cancel();
    replaceVisitorRequest(originRequest, fallback);
    return undefined;
  }

  if (!fromHeader) return response;

  // The cache key has the query, not the header, so a response chosen by the header must not be cached for everyone.
  const uncached = new Response(response.body, response);
  uncached.headers.set("cache-control", "private, no-store");
  return uncached;
}
