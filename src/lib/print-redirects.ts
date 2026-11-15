import type { IntegrationResolvedRoute, RouteData } from "astro";

export function printRedirects(routes: IntegrationResolvedRoute[]): string {
  return routes
    .flatMap(({ type, redirect, redirectRoute, segments }) => {
      if (type !== "redirect" || !redirect) return [];

      const destination =
        typeof redirect === "object" ? redirect.destination : redirect;
      const status = typeof redirect === "object" ? redirect.status : 301;
      const target = redirectRoute
        ? toPattern(redirectRoute.segments, ":splat")
        : destination;

      return [`${toPattern(segments, "*")} ${target} ${status}`];
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
