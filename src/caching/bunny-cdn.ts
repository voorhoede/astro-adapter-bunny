import type { CacheOptions, CacheProvider, InvalidateOptions } from 'astro';
import { setConditionalHeaders } from 'astro/cache/provider-utils';

export type BunnyCdnConfig = { site?: string };

const PURGE_URL = 'https://api.bunny.net/purge';

export default function bunnyCdn(config: BunnyCdnConfig | undefined): CacheProvider {
  return {
    name: 'bunny.net CDN',
    setHeaders: (options: CacheOptions) => {
      const headers = new Headers();
      if (options.maxAge !== undefined) {
        const directives = ['public', `s-maxage=${options.maxAge}`];
        if (options.swr !== undefined) directives.push(`stale-while-revalidate=${options.swr}`);
        headers.set('cache-control', directives.join(', '));
      }
      setConditionalHeaders(headers, options);
      return headers;
    },
    invalidate: (options: InvalidateOptions) => invalidate(options, config?.site),
  };
}

async function invalidate({ path, tags }: InvalidateOptions, site: string | undefined) {
  if (tags !== undefined && tags.length > 0) {
    throw new Error(
      'The bunny.net CDN provider cannot invalidate by tag: bunny.net did not apply tag purges to script responses. Invalidate by path instead.',
    );
  }
  if (path === undefined) return;
  if (site === undefined) {
    throw new Error(
      'Invalidating by path needs `site` in the Astro config, to know the URL to purge.',
    );
  }
  const key = process.env.BUNNY_API_KEY;
  if (!key)
    throw new Error('Invalidating needs the BUNNY_API_KEY script secret, and it is not set.');

  const target = new URL(path, site).href;
  const response = await fetch(`${PURGE_URL}?url=${encodeURIComponent(target)}`, {
    method: 'POST',
    headers: { AccessKey: key },
  });
  if (!response.ok) {
    throw new Error(`bunny.net refused to purge ${target}: ${response.status}.`);
  }
}
