import type { BaseApp } from "astro/app";
import { FetchState, trailingSlash } from "astro/fetch";
import { toVisitorRequest } from "./bunny-helpers.ts";
import { withRenderedCacheControl } from "./cache-control.ts";

/**
 * Astro's redirect to the configured trailing slash form, which Astro itself
 * only applies to the requests it renders.
 */
export function trailingSlashRedirect(
  originRequest: Request,
  app: BaseApp,
): Response | undefined {
  const request = toVisitorRequest(originRequest);

  // Astro skips only paths with an extension, so a stored file without one, such as /CNAME, would redirect to a path that does not exist.
  if (app.manifest.assets.has(new URL(request.url).pathname)) {
    return undefined;
  }

  const redirect = trailingSlash(new FetchState(request));
  if (!redirect) {
    return undefined;
  }

  return withRenderedCacheControl(redirect);
}
