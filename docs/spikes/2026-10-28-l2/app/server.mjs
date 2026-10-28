import { createApp } from 'astro/app/entrypoint';

const app = createApp();

export default {
  fetch: (request) => app.render(request, { routeData: app.match(request) }),
};
