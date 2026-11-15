import type { BaseApp } from "astro/app";

// Mirrors Astro's trailing slash check, which only runs for requests Astro renders.
export function needsTrailingSlashRedirect(
  request: Request,
  app: BaseApp,
): boolean {
  const { pathname } = new URL(request.url);
  const isInternal =
    /^\/[_@.]|^\/[/\\]/.test(pathname) && !/^\/{2,}$/.test(pathname);
  if (pathname === "/" || isInternal || app.manifest.assets.has(pathname)) {
    return false;
  }

  if (/\/{2,}$/.test(pathname)) return true;

  switch (app.manifest.trailingSlash) {
    case "always":
      return !pathname.endsWith("/") && !/\/[^/]+\.\w+$/.test(pathname);
    case "never":
      return pathname.endsWith("/");
    default:
      return false;
  }
}
