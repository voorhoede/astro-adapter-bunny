import { getValidatedIpFromHeader } from "@astrojs/internal-helpers/request";
import type { BaseApp } from "astro/app";
import { withStoredCacheControl } from "./cache-control.ts";
import { withContentType } from "./content-type.ts";
import { addDeployFolder, removeDeployFolder } from "./deploy-folder.ts";
import { FORWARD_SECRET_HEADER, getForwardedHost } from "./deploy-id.ts";

/**
 * Extracts the client IP address from the `x-real-ip` header.
 */
export function getClientAddress(request: Request): string | undefined {
  return getValidatedIpFromHeader(request.headers.get("x-real-ip"));
}

// Building a Request from another moves its body, and the checks and renderApp each ask for the visitor's request. Built once per origin request, the body moves once; a second build left it unusable, and a POST answered 500. A WeakMap lets an entry go with its request.
const visitorRequests = new WeakMap<Request, Request>();

/**
 * Rebuilds the request the visitor made. The script sees the storage origin and
 * the deploy folder instead, which breaks routing, `Astro.url`, absolute
 * redirects, and the origin check on form posts.
 */
export function toVisitorRequest(originRequest: Request): Request {
  let visitorRequest = visitorRequests.get(originRequest);
  if (!visitorRequest) {
    visitorRequest = buildVisitorRequest(originRequest);
    visitorRequests.set(originRequest, visitorRequest);
  }
  return visitorRequest;
}

function buildVisitorRequest(originRequest: Request): Request {
  const { request } = removeDeployFolder(originRequest);
  const url = new URL(request.url);

  const protocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (protocol) url.protocol = protocol;

  // Drops the storage port (:9000) before the visitor's host, which keeps a
  // port of its own, as `astro preview` on localhost:4321 has.
  url.port = "";

  const host = getForwardedHost(request) ?? request.headers.get("host");
  if (host) url.host = host;

  const visitorRequest = new Request(url, request);
  // A page that reads or echoes the request headers would leak the secret. It is deleted in place, because building another Request from this one would move the body again.
  visitorRequest.headers.delete(FORWARD_SECRET_HEADER);
  return visitorRequest;
}

/**
 * The request storage gets: a prerendered page's path rewritten to its file
 * for the `file` and `preserve` build formats, inside the deploy folder.
 */
export function toStorageRequest(
  originRequest: Request,
  app: BaseApp,
): Promise<Request> {
  const { request, folder } = removeDeployFolder(originRequest);
  const url = new URL(request.url);
  const routeData = app.match(request, true);
  const { buildFormat } = app.manifest;
  const path = url.pathname.replace(/\/$/, "");

  if (
    path &&
    routeData &&
    routeData.prerender &&
    routeData.type !== "endpoint" &&
    routeData.type !== "redirect" &&
    (buildFormat === "file" ||
      (buildFormat === "preserve" && !routeData.isIndex))
  ) {
    url.pathname = `${path}.html`;
  }

  return Promise.resolve(addDeployFolder(new Request(url, request), folder));
}

/**
 * Gives a stored file the content type and cache-control storage leaves out.
 */
export function fromStorageResponse(
  originRequest: Request,
  response: Response,
  app: BaseApp,
): Promise<Response> {
  const { pathname } = new URL(toVisitorRequest(originRequest).url);
  const { base, assetsDir } = app.manifest;
  const assetsPath = `${base.replace(/\/$/, "")}/${assetsDir}/`;

  return Promise.resolve(
    withStoredCacheControl(
      withContentType(response, pathname),
      pathname,
      assetsPath,
    ),
  );
}

/**
 * Whether storage holds this path: a public file, an asset or a prerendered
 * page. A redirect route and an on-demand route on the same path are rendered.
 */
export function isStoredPath(originRequest: Request, app: BaseApp): boolean {
  const request = toVisitorRequest(originRequest);
  if (app.match(request)) return false;

  const route = app.match(request, true);
  return (
    app.manifest.assets.has(new URL(request.url).pathname) ||
    (route?.prerender === true && route.type !== "redirect")
  );
}

// Storage only answers GET and HEAD.
export function methodNotAllowed(): Promise<Response> {
  return Promise.resolve(
    new Response(null, { status: 405, headers: { allow: "GET, HEAD" } }),
  );
}

/**
 * Whether a 404 from storage stays as it is: the storage zone's
 * Custom404FilePath answers with the prerendered 404 page, which Astro cannot
 * render here. A path an on-demand route handles is rendered instead.
 */
export function isStoredNotFoundPage(
  originRequest: Request,
  app: BaseApp,
): boolean {
  const hasPrerenderedNotFound = app.manifest.routes.some(
    ({ routeData }) => routeData.route === "/404" && routeData.prerender,
  );
  return hasPrerenderedNotFound && !app.match(toVisitorRequest(originRequest));
}
