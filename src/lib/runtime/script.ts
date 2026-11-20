import { createApp } from "astro/app/entrypoint";
import * as BunnySDK from "@bunny.net/edgescript-sdk";
import {
  fromStorageResponse,
  isStoredNotFoundPage,
  isStoredPath,
  methodNotAllowed,
  toStorageRequest,
} from "./lib/bunny-helpers.ts";
import {
  fromOtherDeployResponse,
  isOtherDeploy,
  toOtherDeployRequest,
} from "./lib/deploy-id.ts";
import { needsTrailingSlashRedirect } from "./lib/needs-trailing-slash-redirect.ts";
import { renderApp } from "./lib/render-app.ts";

const app = createApp();

BunnySDK.net.http
  .servePullZone()
  .onOriginRequest(({ request }) => {
    if (isOtherDeploy(request, app)) {
      return toOtherDeployRequest(request);
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      if (isStoredPath(request, app)) {
        return methodNotAllowed();
      }

      return renderApp(request, app);
    }

    if (needsTrailingSlashRedirect(request, app)) {
      return renderApp(request, app);
    }

    return toStorageRequest(request, app);
  })
  .onOriginResponse(({ request, response }) => {
    if (isOtherDeploy(request, app)) {
      return fromOtherDeployResponse(response);
    }

    if (response.status === 404 && !isStoredNotFoundPage(request, app)) {
      return renderApp(request, app);
    }

    return fromStorageResponse(request, response, app);
  });
