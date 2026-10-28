import { createApp } from 'astro/app/entrypoint';

const app = createApp();

export default {
  fetch: (request: Request) => {
    const routeData = app.match(request, true);
    return app.render(request, { addCookieHeader: true, ...(routeData ? { routeData } : {}) });
  },
};
