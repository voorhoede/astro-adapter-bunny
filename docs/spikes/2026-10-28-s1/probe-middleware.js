// Middleware probe for steps 3a and 4, after shared.js, on a storage-origin pull zone. Needs STORAGE_BASE and the STORAGE_KEY secret.
// /page and /alias both rewrite to pre/page.html with a reserved query parameter and a header.
const VISITOR_PARAM = '__aab_visitor';
const VISITOR_HEADER = 'x-aab-visitor';
const aliases = { '/page': 'pre/page.html', '/alias': 'pre/page.html' };

function visitorPath(request) {
  const url = new URL(request.url);
  const host = request.headers.get('host');
  return { url, host, path: url.pathname };
}

async function onOriginRequest({ request }) {
  try {
    const { url, host, path } = visitorPath(request);
    if (request.headers.has('x-spike-wait')) return Response.json({ marker: MARKER }, { headers: noStore });
    if (url.pathname.endsWith('/facts')) return Response.json({ marker: MARKER, url: request.url, host, path }, { headers: noStore });
    const probeUrl = new URL(path + url.search, `https://${host}`);
    if (path === '/cache') return Response.json({ ...(await partCache(request, probeUrl)), requestUrl: request.url }, { headers: noStore });
    if (path === '/sub') return Response.json(await subrequests(request, probeUrl), { headers: noStore });
    const key = aliases[path];
    if (!key) return request;
    const rewritten = new URL(url);
    rewritten.pathname = `/${key}`;
    rewritten.searchParams.set(VISITOR_PARAM, path);
    const headers = new Headers(request.headers);
    headers.set(VISITOR_HEADER, path);
    return new Request(rewritten, { method: request.method, headers });
  } catch (error) {
    return Response.json({ marker: MARKER, error: String(error?.stack ?? error) }, { status: 500, headers: noStore });
  }
}

async function onOriginResponse({ request, response }) {
  try {
    const { url } = visitorPath(request);
    if (!url.searchParams.has(VISITOR_PARAM) && !request.headers.has(VISITOR_HEADER)) return response;
    const body = await response.text();
    return Response.json({
      marker: MARKER,
      id: crypto.randomUUID(),
      seenUrl: request.url,
      seenQuery: url.searchParams.get(VISITOR_PARAM),
      seenHeader: request.headers.get(VISITOR_HEADER),
      storageStatus: response.status,
      storageHeaders: Object.fromEntries(response.headers),
      storageBody: body.slice(0, 60),
    }, { headers: { 'cache-control': 'public, max-age=300' } });
  } catch (error) {
    return Response.json({ marker: MARKER, error: String(error?.stack ?? error) }, { status: 500, headers: noStore });
  }
}

Bunny.v1.registerMiddlewares({
  onOriginRequest: [onOriginRequest],
  onOriginResponse: [onOriginResponse],
  onClientRequest: [],
  onClientResponse: [],
});
