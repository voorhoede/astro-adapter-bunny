// Standalone probe for steps 3a, 5 and 7, after shared.js. Needs STORAGE_BASE (https://<storage host>/<zone>) and the STORAGE_KEY secret.
function facts(request) {
  return {
    marker: MARKER,
    url: request.url,
    method: request.method,
    headers: Object.fromEntries([...request.headers].filter(([name]) => !['x-real-ip', 'x-forwarded-for', 'cdn-ja4'].includes(name))),
  };
}

function stream() {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`first ${Date.now()}\n`));
      await sleep(2000);
      controller.enqueue(encoder.encode(`second ${Date.now()}\n`));
      controller.close();
    },
  });
  return new Response(body, { headers: { ...noStore, 'content-type': 'text/plain' } });
}

const caching = {
  '/cookie': { 'cache-control': 'public, max-age=60', 'set-cookie': 'spike=1; Path=/' },
  '/vary': { 'cache-control': 's-maxage=60', vary: 'cookie' },
  '/cdncc': { 'cache-control': 'private, no-store', 'cdn-cache-control': 'max-age=60' },
  '/cdncc-off': { 'cache-control': 'public, max-age=60', 'cdn-cache-control': 'no-store' },
  '/plain': { 'cache-control': 'public, max-age=60' },
};

async function handler(request) {
  const url = new URL(request.url);
  if (request.headers.has('x-spike-wait')) return Response.json({ marker: MARKER }, { headers: noStore });
  try {
    if (url.pathname === '/cache') return Response.json(await partCache(request, url), { headers: noStore });
    if (url.pathname === '/sub') return Response.json(await subrequests(request, url), { headers: noStore });
    if (url.pathname === '/stream') return stream();
    if (caching[url.pathname]) {
      return Response.json({ id: crypto.randomUUID(), cookie: request.headers.get('cookie') }, { headers: caching[url.pathname] });
    }
    return Response.json(facts(request), { headers: { ...noStore, 'x-seen-method': request.method } });
  } catch (error) {
    return Response.json({ marker: MARKER, error: String(error?.stack ?? error) }, { status: 500, headers: noStore });
  }
}

Bunny.v1.serve(handler);
