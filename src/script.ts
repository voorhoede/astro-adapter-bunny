import { createApp } from "astro/app/entrypoint";
import * as BunnySDK from "@bunny.net/edgescript-sdk";
import { serveStaticAsset } from "./lib/serve-static-asset.ts";
import { renderApp } from "./lib/render-app.ts";
import { needsTrailingSlashRedirect } from "./lib/needs-trailing-slash-redirect.ts";
import { addDeployFolder, removeDeployFolder } from "./lib/deploy-folder.ts";

const app = createApp();
const hasPrerenderedNotFound = app.manifest.routes.some(
  ({ routeData }) => routeData.route === "/404" && routeData.prerender,
);

BunnySDK.net.http
  .servePullZone()
  .onOriginRequest(({ request: originRequest }) => {
    const { request, folder } = removeDeployFolder(originRequest);

    if (needsTrailingSlashRedirect(request, app)) {
      return renderApp(request, app);
    }

    const routeData = app.match(request, true);
    if (routeData?.type === "redirect") {
      return renderApp(request, app, routeData);
    }

    if (["GET", "HEAD"].includes(request.method)) {
      return serveStaticAsset(request, app).then<Request>((storageRequest) =>
        addDeployFolder(storageRequest, folder),
      );
    }

    if (app.match(request)) {
      return renderApp(request, app);
    }

    const { pathname } = new URL(request.url);
    if (
      app.match(request, true)?.prerender ||
      app.manifest.assets.has(pathname)
    ) {
      return Promise.resolve(
        new Response(null, { status: 405, headers: { allow: "GET, HEAD" } }),
      );
    }

    return renderApp(request, app);
  })
  .onOriginResponse(({ request: originRequest, response }) => {
    const { request } = removeDeployFolder(originRequest);

    if (response.status === 404) {
      // The storage zone's Custom404FilePath answers with the prerendered 404 page, which Astro cannot render here.
      if (hasPrerenderedNotFound && !app.match(request)) {
        return Promise.resolve(response);
      }
      return renderApp(request, app);
    }

    const { pathname } = new URL(request.url);
    const cacheControl = pathname.startsWith(`/${app.manifest.assetsDir}/`)
      ? "public, max-age=31536000, immutable"
      : "public, max-age=0, must-revalidate";
    response.headers.set("cache-control", cacheControl);

    return Promise.resolve(response);
  });
