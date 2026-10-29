const env = (name) => (typeof Deno !== 'undefined' ? Deno.env.get(name) : undefined) ?? '';
const PARTS = env('SPIKE_PARTS_BASE');
const KEY = env('SPIKE_STORAGE_KEY');
const fetchLog = [];

const proto = System.constructor.prototype;
proto.shouldFetch = () => true;
proto.fetch = async (url) => {
  fetchLog.push(url.slice(url.lastIndexOf('/') + 1));
  const response = await fetch(url, { headers: KEY ? { AccessKey: KEY } : {} });
  return new Response(response.body, {
    status: response.status,
    headers: { 'content-type': 'application/javascript', 'x-upstream-type': response.headers.get('content-type') ?? '' },
  });
};

async function attempt(name, fn) {
  const start = performance.now();
  try {
    const value = await fn();
    return { name, ok: true, value: String(value).slice(0, 200), ms: +(performance.now() - start).toFixed(2) };
  } catch (error) {
    return { name, ok: false, error: String(error?.message ?? error).slice(0, 300), ms: +(performance.now() - start).toFixed(2) };
  }
}

async function digest(megabytes) {
  const data = new Uint8Array(megabytes * 1024 * 1024).fill(7);
  const start = performance.now();
  await crypto.subtle.digest('SHA-256', data);
  return +(performance.now() - start).toFixed(2);
}

async function probe(request) {
  const host = request.headers.get('host') ?? new URL(request.url).host;
  const results = [
    await attempt('import data: URL', async () => (await import('data:text/javascript,export default 6*7')).default),
    await attempt('import blob: URL', async () => (await import(URL.createObjectURL(new Blob(['export default 42'], { type: 'text/javascript' })))).default),
    await attempt('import https self', async () => (await import(`https://${host}/mod.js`)).default),
    await attempt('import relative', async () => (await import('./mod.js')).default),
    await attempt('indirect eval', () => (0, eval)('6*7')),
    await attempt('new Function', () => new Function('return 6*7')()),
    await attempt('systemjs chain', async () => {
      const module = await System.import(`${PARTS}entry.js`);
      return `${await module.run()} fetched=${fetchLog.join(',')}`;
    }),
    await attempt('systemjs again', async () => {
      const before = fetchLog.length;
      const module = await System.import(`${PARTS}entry.js`);
      return `${await module.run()} newFetches=${fetchLog.length - before}`;
    }),
  ];
  const sha256Ms = { '0.5MB': await digest(0.5), '3MB': await digest(3), '10MB': await digest(10) };
  return Response.json({
    runtime: typeof Bunny !== 'undefined' ? 'bunny' : 'local',
    deno: typeof Deno !== 'undefined' ? Deno.version : null,
    results,
    sha256Ms,
  }, { headers: { 'cache-control': 'private, no-store' } });
}

function handler(request) {
  const { pathname } = new URL(request.url);
  if (pathname === '/mod.js') {
    return new Response('export default 42', { headers: { 'content-type': 'application/javascript', 'cache-control': 'private, no-store' } });
  }
  return probe(request);
}

if (typeof Bunny !== 'undefined') Bunny.v1.serve(handler);
else Deno.serve({ port: Number(env('PORT') || 8787), hostname: '127.0.0.1' }, handler);
