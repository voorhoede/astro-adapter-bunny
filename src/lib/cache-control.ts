type Source = "script" | "storage";

const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "public, max-age=0, must-revalidate";
const NO_STORE = "private, no-store";

// Without these, bunny.net caches a script response for 30 days and a stored file for ~296.
export function applyCacheControl(
  response: Response,
  source: Source,
  pathname: string,
  assetsPath: string,
): Response {
  if (source === "script") {
    // A route that sets its own header keeps it.
    if (!response.headers.has("cache-control")) {
      response.headers.set("cache-control", NO_STORE);
    }
  } else {
    response.headers.set(
      "cache-control",
      pathname.startsWith(assetsPath) ? IMMUTABLE : REVALIDATE,
    );
  }
  return response;
}
