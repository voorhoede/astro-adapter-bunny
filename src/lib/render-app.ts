import type { RouteData } from "astro";
import type { BaseApp } from "astro/app";
import { getClientAddress, getPublicUrl } from "./bunny-helpers.ts";

declare const Bunny: {
  v1: { waitUntil(promise: Promise<unknown>): void };
};

export async function renderApp(
  request: Request,
  app: BaseApp,
  routeData: RouteData | undefined = app.match(request),
): Promise<Response> {
  const response = await app.render(
    new Request(getPublicUrl(request), request),
    {
      addCookieHeader: true,
      clientAddress: getClientAddress(request),
      // locals,
      // prerenderedErrorPageFetch,
      routeData,
      waitUntil: (promise) => Bunny.v1.waitUntil(promise),
    },
  );

  if (response.headers.has("cache-control")) {
    return response;
  }

  const copy = new Response(response.body, response);
  copy.headers.set("cache-control", "private, no-store");
  return copy;
}
