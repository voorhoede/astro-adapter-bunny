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
  const response = await app.render(
    new Request(getPublicUrl(request), request),
    {
      addCookieHeader: true,
      ...(clientAddress && { clientAddress }),
      // locals,
      // prerenderedErrorPageFetch,
      ...(routeData && { routeData }),
      waitUntil: (promise) => Bunny.v1.waitUntil(promise),
    },
  );

  return withRenderedCacheControl(response);
}
