import * as BunnySDK from '@bunny.net/edgescript-sdk';
import { createApp } from 'astro/app/entrypoint';

const app = createApp();

BunnySDK.net.http.serve((request) => {
  const routeData = app.match(request, true);
  return app.render(request, { addCookieHeader: true, ...(routeData ? { routeData } : {}) });
});
