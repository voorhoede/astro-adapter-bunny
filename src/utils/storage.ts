import type { AstroConfig } from 'astro';
import { extname, join } from 'node:path';

type BuildFormat = AstroConfig['build']['format'];

const { BUNNY_STORAGE_ZONE = '', BUNNY_STORAGE_KEY = '' } = process.env;
const STORAGE_HOST = 'https://storage.bunnycdn.com/';

export async function serveStaticAsset(
  request: Request,
  buildFormat: BuildFormat,
): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);
  const storagePath = join(BUNNY_STORAGE_ZONE, storageFile(pathname, buildFormat));
  const url = new URL(storagePath, STORAGE_HOST);
  const response = await fetch(url, {
    headers: { AccessKey: BUNNY_STORAGE_KEY },
  });

  if (response.status === 200) {
    return new Response(response.body, response);
  }
}

function storageFile(pathname: string, buildFormat: BuildFormat): string {
  if (extname(pathname)) return pathname;
  if (buildFormat === 'file' && pathname !== '/') {
    return `${pathname.replace(/\/$/, '')}.html`;
  }
  return join(pathname, 'index.html');
}
