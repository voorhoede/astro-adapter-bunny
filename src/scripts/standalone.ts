import * as BunnySDK from '@bunny.net/edgescript-sdk';
import { createApp } from 'astro/app/entrypoint';
import { createHandlers } from '../runtime/handlers.ts';
import { deploy, siteData } from '../runtime/platform.ts';
import { readStored } from '../runtime/storage.ts';

const app = createApp();

const handlers = createHandlers({
  app: {
    match: (request) => app.match(request, true),
    render: (request, options) => app.render(request, { addCookieHeader: true, ...options }),
  },
  site: siteData,
  deploy,
  readFile: ({ key }) => readStored(key, deploy().assetPrefix),
  log: (line) => console.error(line),
});

BunnySDK.net.http.serve((request) => handlers.serve(request));
