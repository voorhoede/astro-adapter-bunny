// Shared by both probes: the Cache API part check (3a) and the subrequest count. build.sh prepends it.
const env = (name) => Deno.env.get(name) ?? '';
const MARKER = '__MARKER__';
const noStore = { 'cache-control': 'private, no-store' };
const ms = (start) => +(performance.now() - start).toFixed(1);
const sleep = (n) => new Promise((resolve) => setTimeout(resolve, n));

function storageFetch(key) {
  return fetch(`${env('STORAGE_BASE')}/${key}`, { headers: { AccessKey: env('STORAGE_KEY') } });
}

async function openCache(which) {
  return which === 'default' ? caches.default : await caches.open('parts');
}

async function partCache(request, url) {
  const which = url.searchParams.get('c') ?? 'named';
  const name = url.searchParams.get('k') ?? 'p200k';
  const key = `https://${request.headers.get('host')}/_bunny/server/p200k.js?k=${name}`;
  const out = { marker: MARKER, which, name, zone: request.headers.get('cdn-serverzone') };
  let start = performance.now();
  const cache = await openCache(which);
  out.openMs = ms(start);
  start = performance.now();
  const hit = await cache.match(key);
  out.matchMs = ms(start);
  if (hit) {
    start = performance.now();
    const text = await hit.text();
    out.hit = true;
    out.readMs = ms(start);
    out.bytes = text.length;
    out.storedAt = hit.headers.get('x-stored-at');
    out.ageS = out.storedAt ? Math.round((Date.now() - Number(out.storedAt)) / 1000) : null;
    out.storedZone = hit.headers.get('x-stored-zone');
    return out;
  }
  out.hit = false;
  start = performance.now();
  const response = await storageFetch('_bunny/server/p200k.js');
  const body = await response.arrayBuffer();
  out.fetchMs = ms(start);
  out.fetchStatus = response.status;
  out.bytes = body.byteLength;
  start = performance.now();
  await cache.put(key, new Response(body, {
    headers: {
      'content-type': 'application/javascript',
      'cache-control': 'public, max-age=31536000',
      'x-stored-at': String(Date.now()),
      'x-stored-zone': out.zone ?? '',
    },
  }));
  out.putMs = ms(start);
  return out;
}

async function subrequests(request, url) {
  const ops = Number(url.searchParams.get('ops') ?? 0);
  const kind = url.searchParams.get('kind') ?? 'match';
  const max = Number(url.searchParams.get('max') ?? 60);
  const target = url.searchParams.get('u');
  const cache = await caches.open('parts');
  const key = `https://${request.headers.get('host')}/_bunny/server/sub.js`;
  const out = { marker: MARKER, ops, kind, opErrors: [], fetches: 0, firstFailure: null };
  for (let i = 0; i < ops; i++) {
    try {
      if (kind === 'put') await cache.put(`${key}?i=${i}`, new Response('x', { headers: { 'cache-control': 'public, max-age=600' } }));
      else await cache.match(`${key}?i=${i}`);
    } catch (error) {
      out.opErrors.push(`${i}: ${String(error?.message ?? error).slice(0, 120)}`);
    }
  }
  for (let i = 1; i <= max; i++) {
    try {
      const response = target ? await fetch(target) : await storageFetch('t/a.css');
      await response.arrayBuffer();
      if (!response.ok) { out.firstFailure = `fetch ${i}: status ${response.status}`; break; }
      out.fetches = i;
    } catch (error) {
      out.firstFailure = `fetch ${i}: ${String(error?.message ?? error).slice(0, 160)}`;
      break;
    }
  }
  return out;
}

