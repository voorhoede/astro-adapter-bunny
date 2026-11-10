import { createApp } from 'astro/app/entrypoint';
import * as BunnySDK from '@bunny.net/edgescript-sdk';

const app = createApp();

BunnySDK.net.http
  .servePullZone()
  .onOriginRequest(({ request }) => {
    const routeData = app.match(request);

    if (!routeData) {
      if (['GET', 'HEAD'].includes(request.method)) {
        return Promise.resolve(request);
      }

      return Promise.resolve(new Request(request.url, { headers: request.headers }));
    }

    return render(request);
  })
  .onOriginResponse(({ request, response }) => {
    if (response.status === 404) {
      return render(request);
    }

    const { pathname } = new URL(request.url);
    const { assetsDir } = app.manifest;
    const cacheControl = pathname.startsWith(`/${assetsDir}/`)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=0, must-revalidate';
    response.headers.set('cache-control', cacheControl);

    return Promise.resolve(response);
  });

async function render(request: Request): Promise<Response> {
  // The pull zone hands the script its origin's URL, so the visitor's protocol and host come from headers.
  const url = new URL(request.url);

  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (protocol) url.protocol = protocol;

  const host = request.headers.get('host');
  if (host) url.host = host;

  url.port = '';

  const response = await app.render(new Request(url, request), { addCookieHeader: true });
  if (!response.headers.has('cache-control')) {
    response.headers.set('cache-control', 'private, no-store');
  }

  return response;
}
