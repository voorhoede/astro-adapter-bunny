import { createApp } from "astro/app/entrypoint";
import * as BunnySDK from "@bunny.net/edgescript-sdk";
import { withStoredCacheControl } from "./lib/cache-control.ts";
import { addDeployFolder, removeDeployFolder } from "./lib/deploy-folder.ts";
import { needsTrailingSlashRedirect } from "./lib/needs-trailing-slash-redirect.ts";
import { renderApp } from "./lib/render-app.ts";
import { serveStaticAsset } from "./lib/serve-static-asset.ts";

const app = createApp();
const assetsPath = `${app.manifest.base.replace(/\/$/, "")}/${app.manifest.assetsDir}/`;
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

    const redirectRoute = app.match(request, true);
    if (redirectRoute?.type === "redirect") {
      return renderApp(request, app, redirectRoute);
    }

    if (app.match(request)) {
      return renderApp(request, app);
    }

    // Storage only answers GET and HEAD; anything else must not reach it.
    if (!["GET", "HEAD"].includes(request.method)) {
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
    }

    return serveStaticAsset(request, app).then<Request>((storageRequest) =>
      addDeployFolder(storageRequest, folder),
    );
  })
  .onOriginResponse(({ request: originRequest, response }) => {
    const { request } = removeDeployFolder(originRequest);

    if (response.status === 404) {
      // The storage zone's Custom404FilePath answers with the prerendered 404 page, which Astro cannot render here.
      if (hasPrerenderedNotFound) {
        return Promise.resolve(response);
      }

      return renderApp(request, app);
    }

    const { pathname } = new URL(request.url);
    return Promise.resolve(
      withStoredCacheControl(response, pathname, assetsPath),
    );
  });
