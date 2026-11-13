import type { BaseApp } from "astro/app";

export async function renderApp(
  request: Request,
  app: BaseApp,
): Promise<Response> {
  const url = new URL(request.url);

  const protocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (protocol) url.protocol = protocol;

  const host = request.headers.get("host");
  if (host) url.host = host;

  url.port = "";

  const response = await app.render(new Request(url, request), {
    addCookieHeader: true,
  });

  if (!response.headers.has("cache-control")) {
    response.headers.set("cache-control", "private, no-store");
  }

  return response;
}
