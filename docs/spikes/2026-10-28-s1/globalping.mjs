// usage: node globalping.mjs <public url> <location>[,<location>...] [limit per location]
// One anonymous Globalping HTTP measurement; prints the probe city, the Bunny PoP, timings and the JSON body summary.
const [target, locations, limit = '1'] = process.argv.slice(2);
const url = new URL(target);
const api = 'https://api.globalping.io/v1/measurements';
const response = await fetch(api, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    type: 'http',
    target: url.hostname,
    locations: locations.split(',').map((magic) => ({ magic, limit: Number(limit) })),
    measurementOptions: { protocol: 'HTTPS', request: { method: 'GET', path: url.pathname, query: url.search.slice(1) } },
  }),
});
const created = await response.json();
if (!response.ok) { console.log('globalping error', response.status, JSON.stringify(created)); process.exit(1); }
let result;
for (let i = 0; i < 60; i++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  result = await (await fetch(`${api}/${created.id}`)).json();
  if (result.status !== 'in-progress') break;
}
for (const { probe, result: r } of result.results) {
  const server = r.headers?.server ?? '';
  const cdnCache = r.headers?.['cdn-cache'] ?? '';
  let summary = '';
  try {
    const body = JSON.parse(r.rawBody);
    const keys = ['hit', 'matchMs', 'readMs', 'fetchMs', 'putMs', 'ageS', 'zone', 'storedZone', 'variant', 'count', 'runMs', 'error'];
    summary = JSON.stringify(Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, body[k]])));
    if (body.parts) summary += ' parts ' + body.parts.map((p) => `${p.name}:${p.hit ? 'hit' : 'miss'}:${p.ms}`).join(' ');
  } catch { summary = (r.rawBody ?? '').slice(0, 80).replace(/\s+/g, ' '); }
  console.log(`${probe.city}, ${probe.country} | ${server} | status ${r.statusCode} | ttfb ${r.timings?.firstByte} ms total ${r.timings?.total} ms | cdn-cache ${cdnCache} | ${summary}`);
}
