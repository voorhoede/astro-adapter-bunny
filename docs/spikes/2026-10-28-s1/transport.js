// Standalone probe for the part transports: fetches the four 3c parts concurrently, either from the Storage API
// (STORAGE_BASE, STORAGE_KEY) or through a pull zone in front of the same storage (?zone=<host>, PART_SECRET header).
const env = (name) => Deno.env.get(name) ?? '';
const MARKER = '__MARKER__';
const parts = ['entry.js', 'a.js', 'd.js', 'b.js'];

async function load(name, zone) {
  const start = performance.now();
  const response = zone
    ? await fetch(`https://${zone}/_bunny/server/3c/${name}`, { headers: { 'x-aab-secret': env('PART_SECRET') } })
    : await fetch(`${env('STORAGE_BASE')}/_bunny/server/3c/${name}`, { headers: { AccessKey: env('STORAGE_KEY') } });
  const bytes = (await response.arrayBuffer()).byteLength;
  return { name, status: response.status, bytes, ms: +(performance.now() - start).toFixed(1), cdnCache: response.headers.get('cdn-cache'), server: response.headers.get('server') };
}

Bunny.v1.serve(async (request) => {
  const headers = { 'cache-control': 'private, no-store' };
  if (request.headers.has('x-spike-wait')) return Response.json({ marker: MARKER }, { headers });
  const zone = new URL(request.url).searchParams.get('zone');
  const start = performance.now();
  const results = await Promise.all(parts.map((name) => load(name, zone)));
  return Response.json({ via: zone ? 'zone' : 'storage', runMs: +(performance.now() - start).toFixed(1), parts: results.map((r) => ({ ...r, hit: r.cdnCache === 'HIT' })) }, { headers });
});
