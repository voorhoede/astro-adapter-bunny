import type { RouteData } from "astro";
import type { BaseApp } from "astro/app";
import { getClientAddress, getPublicUrl } from "./bunny-helpers.ts";
import { withRenderedCacheControl } from "./cache-control.ts";

declare const Bunny: {
  v1: { waitUntil(promise: Promise<unknown>): void };
};

export async function renderApp(
  request: Request,
  app: BaseApp,
  routeData: RouteData | undefined = app.match(request),
): Promise<Response> {
  const clientAddress = getClientAddress(request);
  const publicUrl = getPublicUrl(request);
  const response = await app.render(new Request(publicUrl, request), {
    addCookieHeader: true,
    ...(clientAddress && { clientAddress }),
    // locals,
    // Astro fetches a prerendered 404 or 500 page from localhost unless the host is in allowedDomains, which answered an empty page. The pull zone serves it from storage instead.
    prerenderedErrorPageFetch: (url) =>
      fetch(new URL(new URL(url).pathname, publicUrl)),
    ...(routeData && { routeData }),
    waitUntil: (promise) => Bunny.v1.waitUntil(promise),
  });

  return withRenderedCacheControl(response);
}
