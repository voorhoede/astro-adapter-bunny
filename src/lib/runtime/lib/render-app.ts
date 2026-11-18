import type { BaseApp } from "astro/app";
import { getClientAddress, toVisitorRequest } from "./bunny-helpers.ts";
import { withRenderedCacheControl } from "./cache-control.ts";

declare const Bunny: {
  v1: { waitUntil(promise: Promise<unknown>): void };
};

export async function renderApp(
  originRequest: Request,
  app: BaseApp,
): Promise<Response> {
  const request = toVisitorRequest(originRequest);
  let routeData = app.match(request, true);

  if (routeData?.type !== "redirect") {
    routeData = app.match(request);
  }

  const response = await app.render(request, {
    addCookieHeader: true,
    clientAddress: getClientAddress(request),
    routeData,
    // Astro fetches a prerendered 404 or 500 page from localhost unless the host is in allowedDomains, which answered an empty page. The pull zone serves it from storage instead.
    prerenderedErrorPageFetch: (url) =>
      fetch(new URL(new URL(url).pathname, request.url)),
    waitUntil: (promise) => Bunny.v1.waitUntil(promise),
  });

  return withRenderedCacheControl(response);
}
