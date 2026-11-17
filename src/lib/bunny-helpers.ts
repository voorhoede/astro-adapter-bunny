import { getValidatedIpFromHeader } from "@astrojs/internal-helpers/request";

/**
 * Rebuilds the URL the visitor requested. The script sees the storage origin instead,
 * which breaks `Astro.url`, absolute redirects, and the origin check on form posts.
 */
export function getPublicUrl(request: Request): URL {
  const url = new URL(request.url);

  const protocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (protocol) url.protocol = protocol;

  const host = request.headers.get("host");
  if (host) url.host = host;

  url.port = "";

  return url;
}

/**
 * Extracts the client IP address from the `x-real-ip` header.
 */
export function getClientAddress(request: Request): string | undefined {
  return getValidatedIpFromHeader(request.headers.get("x-real-ip"));
}
