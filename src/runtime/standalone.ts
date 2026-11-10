import { createApp } from 'astro/app/entrypoint';
import * as BunnySDK from '@bunny.net/edgescript-sdk';
import { render } from '../utils/render.ts';
import { serveStaticAsset } from '../utils/storage.ts';

const app = createApp();

BunnySDK.net.http.serve(async (request) => {
  const routeData = app.match(request);
  const { assetsDir, buildFormat } = app.manifest;

  if (!routeData) {
    const response = await serveStaticAsset(request, buildFormat);
    if (response) {
      const { pathname } = new URL(request.url);
      const cacheControl = pathname.startsWith(`/${assetsDir}/`)
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate';
      response.headers.set('cache-control', cacheControl);

      return response;
    }
  }

  return render(app, request);
});
