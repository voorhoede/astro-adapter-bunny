import type { BaseApp } from "astro/app";

// Astro appends the query to asset URLs and sends the header with island, action and prefetch requests.
export const DEPLOY_ID_QUERY = "dpl";
export const DEPLOY_ID_HEADER = "x-deployment-id";

const FORWARDED_HOST_HEADER = "x-forwarded-host";
// The deploy tool sets this header on the edge rule that forwards to a deploy's pull zone, and the same value in that deploy's script variable.
export const FORWARD_SECRET_HEADER = "x-bunny-forward-secret";
const FORWARD_SECRET_VARIABLE = "BUNNY_FORWARD_SECRET";

/**
 * Whether a request comes from a page of another deploy. An edge rule sends
 * such a request to that deploy's own pull zone, so the script passes it on
 * and leaves its response alone.
 */
export function isOtherDeploy(originRequest: Request, app: BaseApp): boolean {
  const own = app.manifest.internalFetchHeaders?.[DEPLOY_ID_HEADER];
  if (!own) return false;

  const tag =
    new URL(originRequest.url).searchParams.get(DEPLOY_ID_QUERY) ??
    originRequest.headers.get(DEPLOY_ID_HEADER);
  return tag !== null && tag !== own;
}

/**
 * Names the visitor's host, since the other deploy's pull zone only sees its
 * own hostname. It trusts the header only next to the forward secret.
 */
export function toOtherDeployRequest(originRequest: Request): Promise<Request> {
  const request = new Request(originRequest);
  const host = originRequest.headers.get("host");

  if (host) {
    request.headers.set(FORWARDED_HOST_HEADER, host);
  }

  return Promise.resolve(request);
}

export function fromOtherDeployResponse(response: Response): Promise<Response> {
  return Promise.resolve(response);
}

/**
 * The visitor's host when another deploy forwarded the request with the
 * secret this deploy holds. Anyone can reach this deploy's pull zone and send
 * a host header, so without the secret the header is ignored.
 */
export function getForwardedHost(request: Request): string | undefined {
  const secret = process.env[FORWARD_SECRET_VARIABLE];
  if (!secret || request.headers.get(FORWARD_SECRET_HEADER) !== secret) {
    return undefined;
  }

  return request.headers.get(FORWARDED_HOST_HEADER) ?? undefined;
}
