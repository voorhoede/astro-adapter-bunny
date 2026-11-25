import type { AstroConfig, IntegrationResolvedRoute, RouteData } from "astro";

// Each line says what Astro's own redirect answers for a GET, which the script sends for the same path. The rules follow resolveRedirectTarget and computeRedirectStatus in astro/dist/core/redirects/render.js, which Astro does not export.
export function printRedirects(
  routes: IntegrationResolvedRoute[],
  config: Pick<AstroConfig, "base" | "trailingSlash">,
): string {
  const prefix = config.base.replace(/\/$/, "");

  return routes
    .flatMap(({ type, redirect, redirectRoute, segments }) => {
      if (type !== "redirect" || !redirect) return [];

      // Astro adds the base to the source only, so a target keeps the path it was given.
      const source = `${prefix}${toPattern(segments, "*")}`;
      const target = redirectRoute
        ? toTarget(redirectRoute.segments, config.trailingSlash)
        : typeof redirect === "string"
          ? withParams(redirect, segments)
          : redirect.destination;
      // Astro keeps a configured status only when the target is a route.
      const status =
        redirectRoute && typeof redirect === "object" ? redirect.status : 301;

      return [`${source} ${target} ${status}`];
    })
    .join("\n");
}

// Astro's route generator adds a trailing slash to a route target for 'always'.
function toTarget(
  segments: RouteData["segments"],
  trailingSlash: AstroConfig["trailingSlash"],
): string {
  const path = toPattern(segments, ":splat");
  return trailingSlash === "always" && segments.length
    ? `${path}/`
    : path;
}

// A string target that is not a route gets the source's params, unless it is an external URL.
function withParams(target: string, segments: RouteData["segments"]): string {
  if (/^(https?:)?\/\//.test(target)) return target;

  return segments.flat().reduce((result, { content, dynamic, spread }) => {
    if (!dynamic) return result;

    const name = spread ? content.slice(3) : content;
    const value = spread ? ":splat" : `:${name}`;
    return result
      .replace(`[${name}]`, value)
      .replace(`[...${name}]`, value);
  }, target);
}

function toPattern(segments: RouteData["segments"], spread: string): string {
  const path = segments.map((parts) =>
    parts
      .map(({ content, dynamic, spread: isSpread }) => {
        if (!dynamic) return content;
        return isSpread ? spread : `:${content}`;
      })
      .join(""),
  );

  return `/${path.join("/")}`;
}
