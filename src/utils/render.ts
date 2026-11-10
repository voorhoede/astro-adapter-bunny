import type { BaseApp } from 'astro/app';
import { restoreVisitorUrl } from './visitor-url.ts';

export async function render(app: BaseApp, request: Request): Promise<Response> {
  request = restoreVisitorUrl(request);

  const response = await app.render(request, { addCookieHeader: true });
  if (!response.headers.has('cache-control')) {
    response.headers.set('cache-control', 'private, no-store');
  }

  return response;
}
