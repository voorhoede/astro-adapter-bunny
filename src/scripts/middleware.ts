import * as BunnySDK from '@bunny.net/edgescript-sdk';
import type { OriginRequestContext } from '@bunny.net/edgescript-sdk';
import { createApp } from 'astro/app/entrypoint';
import { createMiddleware } from '../runtime/middleware.ts';
import { deploy, siteData } from '../runtime/platform.ts';

type OriginRequestHook = (ctx: OriginRequestContext) => Promise<Request> | Promise<Response>;

const app = createApp();

const middleware = createMiddleware({
  app: {
    match: (request) => app.match(request, true),
    render: (request, options) => app.render(request, { addCookieHeader: true, ...options }),
  },
  site: siteData,
  deploy,
  fetchPage: (url) => fetch(url),
  log: (line) => console.error(line),
});

BunnySDK.net.http
  .servePullZone()
  // The SDK types this hook as a union of promises, which no async function can return.
  .onOriginRequest(middleware.onOriginRequest as OriginRequestHook)
  .onOriginResponse(middleware.onOriginResponse);
