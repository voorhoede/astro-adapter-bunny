import type { SiteData } from './handlers.ts';

export type Deploy = { assetPrefix: string };

export function visitorUrl(request: Request): URL {
  const url = new URL(request.url);
  const host = request.headers.get('cdn-host') ?? request.headers.get('host') ?? url.host;
  return new URL(`${url.pathname}${url.search}`, `https://${host}`);
}

export function deploy(): Deploy {
  const value: unknown = Reflect.get(globalThis, '__BUNNY_DEPLOY__');
  if (value === undefined) {
    throw new Error('The script has no __BUNNY_DEPLOY__ line; deploy it through a deploy tool.');
  }
  const assetPrefix: unknown =
    typeof value === 'object' && value !== null ? Reflect.get(value, 'assetPrefix') : undefined;
  if (typeof assetPrefix !== 'string' || assetPrefix === '') {
    throw new Error('__BUNNY_DEPLOY__ has no assetPrefix, so the deploy folder is not known.');
  }
  return { assetPrefix };
}

export function siteData(): SiteData {
  return Reflect.get(globalThis, '__BUNNY_SITE__');
}
