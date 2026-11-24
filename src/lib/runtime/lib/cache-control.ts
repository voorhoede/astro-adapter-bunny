// Without these, bunny.net caches a script response for 30 days and a stored file for ~296.

const IMMUTABLE = "public, max-age=31536000, immutable";
// The edge never passes If-None-Match on to the origin, so a stored file answers 304 only from the edge cache, and s-maxage lets the edge keep it. Safe only because a release's files never change and every switch to another release purges the pull zone; without that purge, the edge serves the old release's pages for a day.
const REVALIDATE = "public, max-age=0, must-revalidate, s-maxage=86400";
const NO_STORE = "private, no-store";

// A route that sets its own header keeps it.
export function withRenderedCacheControl(response: Response): Response {
  if (response.headers.has("cache-control")) {
    return response;
  }

  // A copy, because Response.redirect() has immutable headers and setting one throws.
  const copy = new Response(response.body, response);
  copy.headers.set("cache-control", NO_STORE);
  return copy;
}

export function withStoredCacheControl(
  response: Response,
  pathname: string,
  assetsPath: string,
): Response {
  response.headers.set(
    "cache-control",
    pathname.startsWith(assetsPath) ? IMMUTABLE : REVALIDATE,
  );
  return response;
}
