// Runs a script under Deno like bunny.net: as measured, middleware sees the storage URL, a Request reads storage, a throw is an empty 500.
const [script] = Deno.args;
const options = JSON.parse(Deno.env.get('RUN_OPTIONS') ?? '{}');
const STORAGE_ORIGIN = 'http://storage.bunnycdn.com:9000';
const HOST = 'example.com';
const TYPES = {
  html: 'text/html',
  txt: 'text/plain',
  xml: 'application/xml',
  js: 'text/javascript',
  css: 'text/css',
};

let handler;
let middlewares;
let reads = 0;

globalThis.Bunny = {
  v1: {
    serve: (fetch) => (handler = fetch),
    registerMiddlewares: (registered) => (middlewares = registered),
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

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.host === HOST) return throughPullZone({ path: `${url.pathname}${url.search}` });
  const zone = Deno.env.get('BUNNY_STORAGE_ZONE');
  if (url.host !== Deno.env.get('BUNNY_STORAGE_HOST')) return nativeFetch(input, init);
  if (request.headers.get('accesskey') !== Deno.env.get('BUNNY_STORAGE_KEY')) {
    return new Response(null, { status: 401 });
  }
  return storedFile(url.pathname.replace(`/${zone}`, ''));
};

function visitorRequest(spec, origin) {
  return new Request(`${origin}${spec.path}`, {
    method: spec.method ?? 'GET',
    headers: {
      host: HOST,
      'cdn-host': HOST,
      'x-forwarded-proto': 'https',
      'x-real-ip': '203.0.113.7',
      ...spec.headers,
    },
    ...(spec.body === undefined ? {} : { body: spec.body }),
  });
}

async function throughPullZone(spec) {
  const request = visitorRequest(spec, STORAGE_ORIGIN);
  try {
    let result = request;
    for (const hook of middlewares.onOriginRequest) {
      // oxlint-disable-next-line no-await-in-loop
      result = await hook({ request: result });
      if (result instanceof Response) return result;
    }
    let response = await storedFile(new URL(result.url).pathname);
    for (const hook of middlewares.onOriginResponse) {
      // oxlint-disable-next-line no-await-in-loop
      response = await hook({ request: result, response });
    }
    return response;
  } catch {
    return new Response(null, { status: 500, headers: { 'cache-control': 'no-cache' } });
  }
}

const run = { loaded: false, responses: [] };
try {
  await import(new URL(script, 'file://').href);
  run.loaded = handler !== undefined || middlewares !== undefined;
} catch (error) {
  run.error = String(error?.stack ?? error);
}

// Requests run one after another, as later ones may depend on what earlier ones left in the isolate.
for (const spec of run.loaded ? (options.requests ?? []) : []) {
  const before = reads;
  try {
    const pending = middlewares
      ? throughPullZone(spec)
      : handler(visitorRequest(spec, `https://${HOST}`));
    // oxlint-disable-next-line no-await-in-loop
    const response = await pending;
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
