// Stands in for a pull zone as measured: hooks see the storage URL, a Request reads storage, a throw is an empty 500.
export type Registered = {
  serve?: (request: Request) => Response | Promise<Response>;
  middlewares?: {
    onOriginRequest: Array<(ctx: { request: Request }) => Promise<Request | Response> | undefined>;
    onOriginResponse: Array<
      (ctx: { request: Request; response: Response }) => Promise<Response> | undefined
    >;
  };
};

export const STORAGE_ORIGIN = 'http://storage.bunnycdn.com:9000';

export function createPullZone(
  registered: Registered,
  readFile: (path: string) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    if (registered.serve) return registered.serve(withPlatformHeaders(request, request.url, url));
    if (!registered.middlewares) return readFile(url.pathname);
    let result: Request | Response = withPlatformHeaders(
      request,
      `${STORAGE_ORIGIN}${url.pathname}${url.search}`,
      url,
    );
    try {
      for (const hook of registered.middlewares.onOriginRequest) {
        // oxlint-disable-next-line no-await-in-loop
        result = (await hook({ request: result })) ?? result;
        if (result instanceof Response) return result;
      }
      const rewritten = result;
      let response = await readFile(new URL(rewritten.url).pathname);
      for (const hook of registered.middlewares.onOriginResponse) {
        // oxlint-disable-next-line no-await-in-loop
        response = (await hook({ request: rewritten, response })) ?? response;
      }
      return response;
    } catch {
      return new Response(null, { status: 500, headers: { 'cache-control': 'no-cache' } });
    }
  };
}

function withPlatformHeaders(request: Request, target: string, visitor: URL): Request {
  const headers = new Headers(request.headers);
  headers.set('host', visitor.host);
  headers.set('cdn-host', visitor.host);
  headers.set('x-forwarded-proto', visitor.protocol.replace(':', ''));
  return new Request(target, {
    method: request.method,
    headers,
    ...(request.method === 'GET' || request.method === 'HEAD'
      ? {}
      : { body: request.body, duplex: 'half' }),
  });
}
