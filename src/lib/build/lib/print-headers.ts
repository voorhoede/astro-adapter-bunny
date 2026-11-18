import type { RouteToHeaders } from "astro";

// Only the policy belongs to the page: other headers Astro saw while prerendering, such as a fallback's Location, do not.
export function printHeaders(routeToHeaders: RouteToHeaders): string {
  return [...routeToHeaders]
    .flatMap(([pathname, { headers }]) => {
      const policy = headers.get("content-security-policy");
      return policy
        ? [`${pathname}\n  Content-Security-Policy: ${policy}`]
        : [];
    })
    .join("\n");
}
