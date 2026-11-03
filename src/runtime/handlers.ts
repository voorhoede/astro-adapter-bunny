import type { RouteData } from 'astro';
import { finalize, headersFor, type HeaderRule, type Origin } from '../caching/index.ts';
import { decide, withinBase, type Decision, type RouteMatch, type Site } from '../routing/index.ts';
import { visitorUrl, type Deploy } from './platform.ts';

export type Route = Pick<RouteData, 'route' | 'type' | 'params' | 'prerender' | 'isIndex'>;

export type SiteData = Site & { headers: HeaderRule[]; staticCacheControl: string };

type RenderOptions<R> = {
  clientAddress?: string;
  prerenderedErrorPageFetch: (url: string) => Promise<Response>;
  routeData?: R;
};

export type HandlerDeps<R extends Route> = {
  app: {
    match: (request: Request) => R | undefined;
    render: (request: Request, options: RenderOptions<R>) => Promise<Response>;
  };
  site: () => SiteData;
  deploy: () => Deploy;
  // Middleware reads through its own pull zone, standalone through the Storage API.
  readFile: (file: { key: string; url: URL }) => Promise<Response | undefined>;
  log: (line: string) => void;
};

type OriginRequest = { request: Request };
type OriginResponse = { request: Request; response: Response };

const HANDOFF = '__bunny_path';
const ERROR_PAGE = /(404|500)(?:\.html|\/index\.html|\/)?$/;

export function createHandlers<R extends Route>(deps: HandlerDeps<R>) {
  function decideFor(visitor: URL, method: string) {
    const site = deps.site();
    const routes = new Map<string, R | undefined>();
    const match = (pathname: string): RouteMatch | undefined => {
      const route = deps.app.match(new Request(new URL(pathname, visitor)));
      routes.set(pathname, route);
      return (
        route && {
          type: route.type,
          dynamic: route.params.length > 0,
          prerendered: route.prerender,
          index: route.isIndex,
        }
      );
    };
    const decision = decide(
      { method, pathname: visitor.pathname, search: visitor.search },
      site,
      match,
    );
    return { site, decision, route: routes.get(visitor.pathname) };
  }

  function finish(response: Response, origin: Origin, visitor: URL, site: SiteData, route?: R) {
    return finalize(response, origin, {
      pathname: withinBase(visitor.pathname, site.base) ?? visitor.pathname,
      assetsDir: site.assetsDir,
      staticCacheControl: site.staticCacheControl,
      headersFor: (pathname) => headersFor(site.headers, pathname),
      route: route?.route ?? 'an unmatched path',
      log: deps.log,
    });
  }

  function page(key: string, visitor: URL, site: SiteData) {
    return deps.readFile({ key, url: new URL(`${site.base}/${key}`, visitor.origin) });
  }

  async function render(request: Request, visitor: URL, site: SiteData, route?: R) {
    const clientAddress = request.headers.get('x-real-ip');
    const response = await deps.app.render(new Request(visitor, request), {
      prerenderedErrorPageFetch: async (url) => {
        const code = ERROR_PAGE.exec(new URL(url).pathname)?.[1] ?? '404';
        return (
          (await page(`${code}.html`, visitor, site)) ??
          new Response(null, { status: Number(code) })
        );
      },
      ...(clientAddress ? { clientAddress } : {}),
      ...(route ? { routeData: route } : {}),
    });
    return finish(response, 'rendered', visitor, site, route);
  }

  // Answers a decision after the first stored file was missing, or one that needs no stored file.
  async function answer(
    decision: Decision,
    request: Request,
    visitor: URL,
    site: SiteData,
    route?: R,
  ): Promise<Response> {
    if (decision.type === 'render') return render(request, visitor, site, route);
    if (decision.type === 'redirect') return redirect(decision, visitor, site);
    const local = withinBase(visitor.pathname, site.base);
    // The page itself is missing, so fetching it again would only come back here.
    if (local === `/${decision.key}`) {
      return finish(
        new Response(null, { status: decision.status ?? 404 }),
        'adapter',
        visitor,
        site,
      );
    }
    const stored = await page(decision.key, visitor, site);
    if (!stored) return answer(decision.otherwise, request, visitor, site, route);
    return finish(withStatus(stored, decision.status), 'stored', visitor, site);
  }

  function redirect(decision: { status: number; location: string }, visitor: URL, site: SiteData) {
    const response = new Response(null, {
      status: decision.status,
      headers: { location: decision.location },
    });
    return finish(response, 'adapter', visitor, site);
  }

  function failure(error: unknown) {
    deps.log(`The request failed: ${error instanceof Error ? error.message : String(error)}`);
    return new Response(null, {
      status: 500,
      headers: { 'cache-control': 'private, no-store' },
    });
  }

  return {
    async serve(request: Request): Promise<Response> {
      try {
        deps.deploy();
        const visitor = visitorUrl(request);
        const { site, decision, route } = decideFor(visitor, request.method);
        if (decision.type !== 'file') return await answer(decision, request, visitor, site, route);
        const stored = await page(decision.key, visitor, site);
        if (!stored) return await answer(decision.otherwise, request, visitor, site, route);
        return finish(withStatus(stored, decision.status), 'stored', visitor, site);
      } catch (error) {
        return failure(error);
      }
    },

    async onOriginRequest({ request }: OriginRequest): Promise<Request | Response> {
      try {
        const { assetPrefix } = deps.deploy();
        const visitor = visitorUrl(request);
        const { site, decision, route } = decideFor(visitor, request.method);
        if (decision.type === 'render') return await render(request, visitor, site, route);
        if (decision.type === 'redirect') return redirect(decision, visitor, site);
        const key = decision.key.split('/').map(encodeURIComponent).join('/');
        const target = new URL(`/${assetPrefix}/${key}`, new URL(request.url).origin);
        target.searchParams.set(HANDOFF, `${visitor.pathname}${visitor.search}`);
        return new Request(target, { method: request.method, headers: request.headers });
      } catch (error) {
        return failure(error);
      }
    },

    async onOriginResponse({ request, response }: OriginResponse): Promise<Response> {
      try {
        const handoff = new URL(request.url).searchParams.get(HANDOFF);
        const visitor = new URL(handoff ?? '/', visitorUrl(request).origin);
        const { site, decision, route } = decideFor(visitor, request.method);
        if (decision.type !== 'file') return await answer(decision, request, visitor, site, route);
        if (response.status === 404) {
          return await answer(decision.otherwise, request, visitor, site, route);
        }
        return finish(withStatus(response, decision.status), 'stored', visitor, site);
      } catch (error) {
        return failure(error);
      }
    },
  };
}

function withStatus(response: Response, status: number | undefined): Response {
  if (status === undefined || status === response.status) return response;
  return new Response(response.body, { status, headers: response.headers });
}
