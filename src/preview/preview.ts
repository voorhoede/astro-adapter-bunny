import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CreatePreviewServer } from 'astro';
import { createPullZone, type Registered } from './pull-zone.ts';

const PREFIX = '/deploys/preview/';
const STORAGE = { zone: 'preview', host: 'storage.preview.invalid', key: 'preview' };
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const createPreviewServer: CreatePreviewServer = async ({ outDir, client, host, port, logger }) => {
  const clientDir = fileURLToPath(client);
  const script = join(fileURLToPath(outDir), 'index.js');
  const registered: Registered = {};

  const stored = async (path: string) => {
    const relative = path.startsWith(PREFIX) ? path.slice(PREFIX.length) : path.replace(/^\//, '');
    const file = normalize(join(clientDir, decodeURIComponent(relative)));
    if (!file.startsWith(clientDir) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
      return new Response(null, { status: 404 });
    }
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    return new Response(await readFile(file), { headers: { 'content-type': type } });
  };

  // Without a script the site is static, so a path resolves to its page the way the deployed files do.
  const staticFile = async (path: string) => {
    const page = path.replace(/\/$/, '');
    for (const candidate of [path, `${page}/index.html`, `${page}.html`]) {
      // oxlint-disable-next-line no-await-in-loop
      const response = await stored(candidate);
      if (response.ok) return response;
    }
    const notFound = await stored('/404.html');
    return new Response(notFound.ok ? notFound.body : null, {
      status: 404,
      headers: notFound.headers,
    });
  };

  const pullZone = createPullZone(registered, (path) =>
    path.startsWith(PREFIX) ? stored(path) : staticFile(path),
  );
  const nativeFetch = globalThis.fetch;
  Object.assign(globalThis, {
    Bunny: {
      v1: {
        serve: (handler: NonNullable<Registered['serve']>) => (registered.serve = handler),
        registerMiddlewares: (middlewares: NonNullable<Registered['middlewares']>) =>
          (registered.middlewares = middlewares),
        waitUntil: () => {},
      },
    },
    __BUNNY_DEPLOY__: { id: 'preview', assetPrefix: PREFIX.slice(1, -1) },
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.host === STORAGE.host) return stored(url.pathname.replace(`/${STORAGE.zone}`, ''));
      if (url.host === origin.host) return pullZone(request);
      return nativeFetch(input, init);
    },
  });
  process.env.BUNNY_STORAGE_ZONE ??= STORAGE.zone;
  process.env.BUNNY_STORAGE_HOST ??= STORAGE.host;
  process.env.BUNNY_STORAGE_KEY ??= STORAGE.key;

  // Node caches modules by URL, so a rebuilt script in the same process needs its own URL.
  if (existsSync(script)) await import(`${pathToFileURL(script).href}?${statSync(script).mtimeMs}`);

  const server = createServer((incoming, outgoing) => {
    void answer(incoming, outgoing).catch((error: unknown) => {
      logger.error(String(error));
      outgoing.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const origin = new URL(`http://${host ?? 'localhost'}:${actualPort}`);
  logger.info(`Previewing the built script at ${origin.href}`);

  async function answer(incoming: IncomingMessage, outgoing: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (typeof value === 'string') headers.set(name, value);
    }
    headers.set('x-real-ip', incoming.socket.remoteAddress ?? '127.0.0.1');
    const method = incoming.method ?? 'GET';
    const request = new Request(new URL(incoming.url ?? '/', origin), {
      method,
      headers,
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }),
    });
    const response = await pullZone(request);
    const head: Record<string, string | string[]> = {};
    for (const [name, value] of response.headers) if (name !== 'set-cookie') head[name] = value;
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) head['set-cookie'] = cookies;
    outgoing.writeHead(response.status, head);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  }

  const closed = new Promise<void>((resolve) => server.on('close', resolve));
  return {
    ...(host ? { host } : {}),
    port: actualPort,
    closed: () => closed,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

export default createPreviewServer;
