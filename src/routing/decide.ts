import { fill, matchPath } from '../shared/path-pattern.ts';
import type { AstroConfig, RouteData } from 'astro';
import { keySegments, storageKey, type Format, type Page } from './storage-key.ts';

export type RouteMatch = {
  type: RouteData['type'];
  dynamic: boolean;
  prerendered: boolean;
  index: boolean;
};

export type RedirectRule = { from: string; to: string; status?: number };

export type Site = {
  base: string;
  trailingSlash: AstroConfig['trailingSlash'];
  format: Format;
  assetsDir: string;
  notFoundPrerendered: boolean;
  redirects: RedirectRule[];
};

export type Decision =
  | { type: 'render' }
  | { type: 'redirect'; status: number; location: string }
  | { type: 'file'; key: string; status?: 404; otherwise: Decision };

export type VisitorRequest = { method: string; pathname: string; search: string };

const RESERVED_FILES = new Set(['_headers', '_redirects']);

export function decide(
  request: VisitorRequest,
  site: Site,
  match: (pathname: string) => RouteMatch | undefined,
): Decision {
  const { method, pathname, search } = request;
  const local = withinBase(pathname, site.base);
  const notFound = notFoundFor(site);

  if (local === undefined) return notFound;
  if (local.startsWith(`/${site.assetsDir}/`)) return file(local, site, notFound);
  if (isReserved(local)) return notFound;
  if (method !== 'GET' && method !== 'HEAD') return { type: 'render' };

  const route = match(pathname);
  if (route && (route.type === 'redirect' || !route.prerendered)) {
    return route.dynamic && route.type !== 'redirect'
      ? file(local, site, { type: 'render' })
      : { type: 'render' };
  }
  const page = route && route.type !== 'endpoint' ? { index: route.index } : undefined;

  for (const rule of site.redirects) {
    const captures = matchPath(rule.from, pathname);
    if (!captures) continue;
    const target = fill(rule.to, captures);
    const status = rule.status ?? 302;
    if (status === 200) return file(withinBase(target, site.base) ?? target, site, notFound);
    return { type: 'redirect', status, location: target.includes('?') ? target : target + search };
  }

  const slash = trailingSlashTarget(pathname, local, site);
  if (slash !== undefined) return { type: 'redirect', status: 301, location: slash + search };

  return file(local, site, notFound, page);
}

// Storage reads through the CDN ignore case, so reserved paths are compared on the key the read would use.
function isReserved(local: string): boolean {
  const [first, ...rest] = keySegments(local).map((segment) => segment.toLowerCase());
  return (
    first === '_bunny' || (first !== undefined && rest.length === 0 && RESERVED_FILES.has(first))
  );
}

function withinBase(pathname: string, base: string): string | undefined {
  if (base === '') return pathname;
  if (pathname === base) return '/';
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : undefined;
}

function notFoundFor(site: Site): Decision {
  return site.notFoundPrerendered
    ? { type: 'file', key: '404.html', status: 404, otherwise: { type: 'render' } }
    : { type: 'render' };
}

function file(local: string, site: Site, otherwise: Decision, page?: Page): Decision {
  return { type: 'file', key: storageKey(local, site.format, page), otherwise };
}

function trailingSlashTarget(pathname: string, local: string, site: Site): string | undefined {
  if (local.split('/').at(-1)?.includes('.')) return undefined;
  if (site.trailingSlash === 'always' && !pathname.endsWith('/')) return `${pathname}/`;
  if (site.trailingSlash === 'never' && pathname.endsWith('/') && local !== '/')
    return pathname.slice(0, -1);
  return undefined;
}
