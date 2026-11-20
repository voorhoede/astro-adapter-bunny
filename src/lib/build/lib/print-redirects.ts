import type { IntegrationResolvedRoute, RouteData } from "astro";

export function printRedirects(
  routes: IntegrationResolvedRoute[],
  base: string,
): string {
  const prefix = base.replace(/\/$/, "");

  return routes
    .flatMap(({ type, redirect, redirectRoute, segments }) => {
      if (type !== "redirect" || !redirect) return [];

      const destination =
        typeof redirect === "object" ? redirect.destination : redirect;
      const status = typeof redirect === "object" ? redirect.status : 301;
      const target = redirectRoute
        ? toPattern(redirectRoute.segments, ":splat")
        : destination;

      // Astro adds the base to the source only, so a target keeps the path it was given.
      return [`${prefix}${toPattern(segments, "*")} ${target} ${status}`];
    })
    .join("\n");
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
