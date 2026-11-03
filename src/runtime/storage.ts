import { keySegments } from '../routing/storage-key.ts';

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  xml: 'application/xml',
  txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  pdf: 'application/pdf',
  wasm: 'application/wasm',
};

const VARIABLES = ['BUNNY_STORAGE_ZONE', 'BUNNY_STORAGE_HOST', 'BUNNY_STORAGE_KEY'] as const;

export async function readStored(key: string, assetPrefix: string): Promise<Response | undefined> {
  const [zone, host, password] = VARIABLES.map((name) => {
    const value = process.env[name];
    if (!value) throw new Error(`Reading from storage needs the ${name} script variable.`);
    return value;
  });
  const path = [...keySegments(assetPrefix), ...keySegments(key)].map(encodeURIComponent).join('/');
  const response = await fetch(`https://${host}/${zone}/${path}`, {
    headers: { AccessKey: password ?? '' },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Storage answered ${response.status} for ${key}.`);
  return withType(response, key);
}

// The Storage API answers application/octet-stream for types it does not know, such as .webmanifest.
function withType(response: Response, key: string): Response {
  const sent = response.headers.get('content-type');
  const type = TYPES[key.split('.').pop()?.toLowerCase() ?? ''];
  if (!type || (sent && sent !== 'application/octet-stream')) return response;
  const headers = new Headers(response.headers);
  headers.set('content-type', type);
  return new Response(response.body, { status: response.status, headers });
}
