import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.fromMiddleware = 'hello';
  const response = await next();
  response.headers.set('x-middleware', 'ran');
  return response;
});
