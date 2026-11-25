import { createApp } from "astro/app/entrypoint";
import * as BunnySDK from "@bunny.net/edgescript-sdk";
import {
  fromStorageResponse,
  isStoredNotFoundPage,
  isStoredPath,
  methodNotAllowed,
  toStorageRequest,
} from "./lib/bunny-helpers.ts";
import { renderApp } from "./lib/render-app.ts";
import { trailingSlashRedirect } from "./lib/trailing-slash-redirect.ts";

const app = createApp();

BunnySDK.net.http
  .servePullZone()
  .onOriginRequest(({ request }) => {
    if (!["GET", "HEAD"].includes(request.method)) {
      if (isStoredPath(request, app)) {
        return methodNotAllowed();
      }

      return renderApp(request, app);
    }

    const redirect = trailingSlashRedirect(request, app);
    if (redirect) {
      return Promise.resolve(redirect);
    }

    return toStorageRequest(request, app);
  })
  .onOriginResponse(({ request, response }) => {
    if (response.status === 404 && !isStoredNotFoundPage(request, app)) {
      return renderApp(request, app);
    }

    return fromStorageResponse(request, response, app);
  });
