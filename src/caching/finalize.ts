export type Origin = 'rendered' | 'stored' | 'adapter';

export type Context = {
  pathname: string;
  assetsDir: string;
  staticCacheControl: string;
  headersFor: (pathname: string) => Array<[string, string]>;
  route: string;
  log: (line: string) => void;
};

const PRIVATE = 'private, no-store';
const IMMUTABLE = 'public, max-age=31536000, immutable';

export function finalize(response: Response, origin: Origin, context: Context): Response {
  const headers = new Headers(response.headers);

  if (origin === 'stored') {
    for (const [name, value] of context.headersFor(context.pathname)) {
      if (name.toLowerCase() !== 'cache-control' && !headers.has(name)) headers.set(name, value);
    }
  }

  if (response.status >= 500) {
    headers.set('cache-control', PRIVATE);
  } else if (origin === 'rendered') {
    if (!headers.has('cache-control')) headers.set('cache-control', PRIVATE);
    const reason = sharedCacheBreaker(headers);
    if (reason && isSharedCacheable(headers.get('cache-control') ?? '')) {
      headers.set('cache-control', PRIVATE);
      context.log(`Made ${context.route} ${PRIVATE}, because the response ${reason}.`);
    }
  } else if (origin === 'stored' && context.pathname.startsWith(`/${context.assetsDir}/`)) {
    headers.set('cache-control', IMMUTABLE);
  } else if (!headers.has('cache-control')) {
    headers.set('cache-control', context.staticCacheControl);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function sharedCacheBreaker(headers: Headers): string | undefined {
  if (headers.has('set-cookie')) return 'sets a cookie';
  const vary = (headers.get('vary') ?? '').split(',').map((name) => name.trim().toLowerCase());
  if (vary.some((name) => name !== '' && name !== 'accept-encoding'))
    return 'varies on more than accept-encoding';
  return undefined;
}

function isSharedCacheable(cacheControl: string): boolean {
  return !/\b(private|no-store)\b/i.test(cacheControl);
}
