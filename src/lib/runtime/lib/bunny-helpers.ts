import { getValidatedIpFromHeader } from "@astrojs/internal-helpers/request";
import type { BaseApp } from "astro/app";
import { withStoredCacheControl } from "./cache-control.ts";
import { withContentType } from "./content-type.ts";

declare const process: { env: Record<string, string | undefined> };

/** Headers one release sends to another when it forwards a visitor's request. */
export const FORWARD = {
  secret: "x-bunny-forward-secret",
  host: "x-bunny-forwarded-host",
  proto: "x-bunny-forwarded-proto",
  address: "x-bunny-forwarded-for",
} as const;

/**
 * Whether another release of this site forwarded the request: it carries the
 * secret the deploy sets on every script of the site. Only then are the
 * forwarded host, protocol and address the visitor's.
 */
export function isForwarded(originRequest: Request): boolean {
  const secret = process.env.BUNNY_FORWARD_SECRET;
  return !!secret && originRequest.headers.get(FORWARD.secret) === secret;
}

/**
 * Extracts the client IP address from the `x-real-ip` header.
 */
export function getClientAddress(request: Request): string | undefined {
  return getValidatedIpFromHeader(request.headers.get("x-real-ip"));
}

// Building a Request from another moves its body, and the checks and renderApp each ask for the visitor's request. Built once per origin request, the body moves once; a second build left it unusable, and a POST answered 500. A WeakMap lets an entry go with its request.
const visitorRequests = new WeakMap<Request, Request>();

/**
 * Rebuilds the request the visitor made. The script sees the storage origin
 * instead, which breaks routing, `Astro.url`, absolute redirects, and the
 * origin check on form posts.
 */
export function toVisitorRequest(originRequest: Request): Request {
  let visitorRequest = visitorRequests.get(originRequest);
  if (!visitorRequest) {
    visitorRequest = buildVisitorRequest(originRequest);
    visitorRequests.set(originRequest, visitorRequest);
  }
  return visitorRequest;
}

/** Puts back a visitor request whose body was sent to another release that did not answer. */
export function replaceVisitorRequest(
  originRequest: Request,
  visitorRequest: Request,
): void {
  visitorRequests.set(originRequest, visitorRequest);
}

function buildVisitorRequest(request: Request): Request {
  const url = new URL(request.url);
  const forwarded = isForwarded(request);
  const header = (name: string) =>
    request.headers.get(name)?.split(",")[0]?.trim();

  const protocol = forwarded
    ? header(FORWARD.proto)
    : header("x-forwarded-proto");
  if (protocol) url.protocol = protocol;

  url.port = "";

  const host = forwarded ? header(FORWARD.host) : header("host");
  if (host) url.host = host;

  const visitorRequest = new Request(url, request);
  const address = forwarded && header(FORWARD.address);
  if (address) visitorRequest.headers.set("x-real-ip", address);
  // A forwarded request never shows the secret or the forwarding headers to the site's code.
  for (const name of [FORWARD.secret, FORWARD.host, FORWARD.proto, FORWARD.address]) {
    visitorRequest.headers.delete(name);
  }
  return visitorRequest;
}

/**
 * The request storage gets: a prerendered page's path rewritten to its file
 * for the `file` and `preserve` build formats.
 */
export function toStorageRequest(
  request: Request,
  app: BaseApp,
): Promise<Request> {
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

  return Promise.resolve(new Request(url, request));
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

let assetPaths: Set<string> | undefined;

/**
 * Whether the build stored a file at this path. Astro appends the release's
 * `?dpl=` to every path in `manifest.assets`, so the paths are compared
 * without it.
 */
export function isStoredFile(app: BaseApp, pathname: string): boolean {
  assetPaths ??= new Set(
    [...app.manifest.assets].map((path) => path.split("?")[0]!),
  );
  return assetPaths.has(pathname);
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
    isStoredFile(app, new URL(request.url).pathname) ||
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
