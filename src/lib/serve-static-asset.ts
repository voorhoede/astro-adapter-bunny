import type { BaseApp } from "astro/app";

export function serveStaticAsset(request: Request, app: BaseApp) {
  const url = new URL(request.url);
  const routeData = app.match(request, true);
  const { buildFormat } = app.manifest;
  const path = url.pathname.replace(/\/$/, "");

  if (
    path &&
    routeData &&
    routeData.prerender &&
    routeData.type !== "endpoint" &&
    (buildFormat === "file" ||
      (buildFormat === "preserve" && !routeData.isIndex))
  ) {
    url.pathname = `${path}.html`;
    return Promise.resolve(new Request(url, request));
  }

  return Promise.resolve(request);
}
