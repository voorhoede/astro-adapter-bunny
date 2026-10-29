import { defineMiddleware } from 'astro:middleware';

// Spike only: tells a cold isolate (count 1) from a warm one, and times the handler.
const isolate = crypto.randomUUID().slice(0, 8);
const loadedAt = performance.now();
let count = 0;

export const onRequest = defineMiddleware(async (_context, next) => {
  const start = performance.now();
  count++;
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set('x-spike-isolate', isolate);
  headers.set('x-spike-count', String(count));
  headers.set('x-spike-loaded', loadedAt.toFixed(1));
  headers.set('x-spike-start', start.toFixed(1));
  headers.set('x-spike-run', (performance.now() - start).toFixed(1));
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
});
