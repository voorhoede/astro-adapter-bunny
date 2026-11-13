import { createApp } from "astro/app/entrypoint";
import * as BunnySDK from "@bunny.net/edgescript-sdk";
import { renderApp } from "./lib/render-app.ts";

const app = createApp();

BunnySDK.net.http
  .servePullZone()
  .onOriginRequest(({ request }) => {
    const routeData = app.match(request);

    if (!routeData) {
      if (["GET", "HEAD"].includes(request.method)) {
        return Promise.resolve(request);
      }

      return Promise.resolve(
        new Request(request.url, { headers: request.headers }),
      );
    }

    return renderApp(request, app);
  })
  .onOriginResponse(({ request, response }) => {
    if (response.status === 404) {
      return renderApp(request, app);
    }

    const { pathname } = new URL(request.url);
    const { assetsDir } = app.manifest;
    const cacheControl = pathname.startsWith(`/${assetsDir}/`)
      ? "public, max-age=31536000, immutable"
      : "public, max-age=0, must-revalidate";
    response.headers.set("cache-control", cacheControl);

    return Promise.resolve(response);
  });
