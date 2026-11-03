// Runs a built script under Deno, the runtime bunny.net uses, behind the same pull zone stand-in as astro preview.
import { createPullZone } from '../../src/preview/pull-zone.ts';

const [script] = Deno.args;
const options = JSON.parse(Deno.env.get('RUN_OPTIONS') ?? '{}');
const HOST = 'example.com';
const TYPES = {
  html: 'text/html',
  txt: 'text/plain',
  xml: 'application/xml',
  js: 'text/javascript',
  css: 'text/css',
};

const registered = {};
let reads = 0;

globalThis.Bunny = {
  v1: {
    serve: (handler) => (registered.serve = handler),
    registerMiddlewares: (middlewares) => (registered.middlewares = middlewares),
    waitUntil: () => {},
  },
};
if (options.deploy !== false) {
  globalThis.__BUNNY_DEPLOY__ = { id: 'test', assetPrefix: 'deploys/test' };
}

async function storedFile(path) {
  reads++;
  const prefix = '/deploys/test/';
  const decoded = decodeURIComponent(path);
  if (!options.client || !decoded.startsWith(prefix)) return new Response(null, { status: 404 });
  try {
    const body = await Deno.readFile(`${options.client}/${decoded.slice(prefix.length)}`);
    const type = TYPES[decoded.split('.').pop()] ?? 'application/octet-stream';
    return new Response(body, { headers: { 'content-type': type } });
  } catch {
    return new Response(null, { status: 404 });
  }
}

const pullZone = createPullZone(registered, storedFile);
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.host === HOST) return pullZone(request);
  const zone = Deno.env.get('BUNNY_STORAGE_ZONE');
  if (url.host !== Deno.env.get('BUNNY_STORAGE_HOST')) return nativeFetch(input, init);
  if (request.headers.get('accesskey') !== Deno.env.get('BUNNY_STORAGE_KEY')) {
    return new Response(null, { status: 401 });
  }
  return storedFile(url.pathname.replace(`/${zone}`, ''));
};

function visitorRequest(spec) {
  return new Request(`https://${HOST}${spec.path}`, {
    method: spec.method ?? 'GET',
    headers: { 'x-real-ip': '203.0.113.7', ...spec.headers },
    ...(spec.body === undefined ? {} : { body: spec.body }),
  });
}

const run = { loaded: false, responses: [] };
try {
  await import(new URL(script, 'file://').href);
  run.loaded = registered.serve !== undefined || registered.middlewares !== undefined;
} catch (error) {
  run.error = String(error?.stack ?? error);
}

// Requests run one after another, as later ones may depend on what earlier ones left in the isolate.
for (const spec of run.loaded ? (options.requests ?? []) : []) {
  const before = reads;
  try {
    // oxlint-disable-next-line no-await-in-loop
    const response = await pullZone(visitorRequest(spec));
    run.responses.push({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      setCookies: response.headers.getSetCookie(),
      // oxlint-disable-next-line no-await-in-loop
      body: await response.text(),
      reads: reads - before,
    });
  } catch (error) {
    run.responses.push({
      status: 0,
      headers: {},
      setCookies: [],
      body: String(error?.stack ?? error),
      reads: reads - before,
    });
  }
}

console.log(JSON.stringify(run));
