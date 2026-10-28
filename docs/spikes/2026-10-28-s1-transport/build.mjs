// usage: node build.mjs <parts dir> <out dir> <entry> <part>[,<part>...] [kB cap for all.js]
// Writes three standalone scripts that render a route with `module.default.fetch(request)` under SystemJS:
// <out>/split.js loads parts at runtime (PART_ZONE + PART_SECRET through a pull zone, or STORAGE_BASE + STORAGE_KEY),
// <out>/one.js registers the named parts inside the script, and <out>/all.js registers every part in <parts dir>,
// the named ones first, up to the cap.
// Each answers JSON with timings; ?route=<path> picks the route (without it, 404), ?fresh=1 uses a new loader in the same isolate,
// ?bust=<n> adds a query to every part URL so the pull zone misses, and on split.js ?probe=<part>[,<part>...]&bust=<n>
// only fetches those parts concurrently through the pull zone and reports timings and the CDN's storage server.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [dir, out, entry, list, cap = 'Infinity'] = process.argv.slice(2);
const marker = `tr-${Date.now()}`;
const systemjs = readFileSync(createRequire(import.meta.url).resolve('systemjs/dist/system.min.js'), 'utf8');
mkdirSync(out, { recursive: true });

const handler = (variant) => `
const bootedAt = Date.now();
const bootPerfMs = +performance.now().toFixed(1);
let requestStart = 0;
const isolate = crypto.randomUUID().slice(0, 8);
const env = (name) => Deno.env.get(name) ?? '';
const noStore = { 'cache-control': 'private, no-store' };
const base = 'https://parts.invalid/';
let shared;
let count = 0;
let log = [];
Bunny.v1.serve(async (request) => {
  if (request.headers.has('x-spike-wait')) return Response.json({ marker: '${marker}-${variant}' }, { headers: noStore });
  count++;
  const url = new URL(request.url);
  if (url.searchParams.has('probe') && globalThis.probeParts) return Response.json(await probeParts(url), { headers: noStore });
  if (!url.searchParams.has('route')) return new Response('not found', { status: 404, headers: noStore });
  const fresh = url.searchParams.has('fresh') || !shared;
  const loader = fresh ? new System.constructor() : shared;
  if (!shared) shared = loader;
  loader.bust = url.searchParams.get('bust');
  log = [];
  const start = performance.now();
  requestStart = start;
  try {
    const module = await loader.import(base + '${entry}');
    const eagerMs = performance.now() - start;
    const response = await module.default.fetch(new Request(new URL(url.searchParams.get('route'), url)));
    const body = await response.text();
    const ms = (n) => +n.toFixed(1);
    return Response.json({
      variant: '${variant}', isolate, count, fresh, bootPerfMs, bootAgeMs: Date.now() - bootedAt, pop: request.headers.get('cdn-serverzone'),
      status: response.status, bodyBytes: body.length, eagerMs: ms(eagerMs), renderMs: ms(performance.now() - start - eagerMs), runMs: ms(performance.now() - start),
      parts: log,
    }, { headers: noStore });
  } catch (error) {
    return Response.json({ variant: '${variant}', isolate, count, error: String(error?.stack ?? error).slice(0, 600), parts: log }, { status: 500, headers: noStore });
  }
});
`;

writeFileSync(join(out, 'split.js'), `${systemjs}
const proto = System.constructor.prototype;
proto.shouldFetch = () => true;
proto.fetch = async function (url) {
  const name = url.slice(base.length);
  const start = performance.now();
  const query = this.bust ? \`?b=\${this.bust}\` : '';
  const response = env('PART_ZONE')
    ? await fetch(\`https://\${env('PART_ZONE')}/_bunny/server/\${env('RELEASE')}/\${name}\${query}\`, { headers: { 'x-aab-secret': env('PART_SECRET') } })
    : await fetch(\`\${env('STORAGE_BASE')}/_bunny/server/\${env('RELEASE')}/\${name}\`, { headers: { AccessKey: env('STORAGE_KEY') } });
  const text = await response.text();
  log.push({ name: name.replace(/-[\\w-]+\\.js$/, ''), status: response.status, kB: Math.round(text.length / 1024), ms: +(performance.now() - start).toFixed(1), cdn: response.headers.get('cdn-cache'), at: +(start - requestStart).toFixed(1) });
  if (!response.ok) throw new Error(\`part \${name}: \${response.status}\`);
  return new Response(text, { headers: { 'content-type': 'application/javascript' } });
};
async function probeParts(url) {
  const names = url.searchParams.get('probe').split(',');
  const start = performance.now();
  const results = await Promise.all(names.map(async (name) => {
    const t = performance.now();
    const response = await fetch(\`https://\${env('PART_ZONE')}/_bunny/server/\${env('RELEASE')}/\${name}?b=\${url.searchParams.get('bust')}\`, { headers: { 'x-aab-secret': env('PART_SECRET') } });
    const headersMs = +(performance.now() - t).toFixed(1);
    const bytes = (await response.arrayBuffer()).byteLength;
    return { name: name.slice(0, 12), status: response.status, bytes, headersMs, ms: +(performance.now() - t).toFixed(1), cdn: response.headers.get('cdn-cache'), server: response.headers.get('server'), headers: [...response.headers.keys()].filter((k) => k.startsWith('cdn-')).map((k) => \`\${k}=\${response.headers.get(k)}\`) };
  }));
  return { isolate, totalMs: +(performance.now() - start).toFixed(1), results };
}
globalThis.probeParts = probeParts;
${handler('split')}`);

const inline = (files, variant) => `${systemjs}
const parts = {
${files.map((file) => `${JSON.stringify(file)}: function () {\n${readFileSync(join(dir, file), 'utf8')}\n},`).join('\n')}
};
const proto = System.constructor.prototype;
proto.instantiate = function (url) {
  const name = url.slice(base.length);
  const start = performance.now();
  parts[name]();
  log.push({ name: name.replace(/-[\\w-]+\\.js$/, ''), ms: +(performance.now() - start).toFixed(1) });
  return this.getRegister(url);
};
${handler(variant)}`;

const named = [entry, ...list.split(',')];
writeFileSync(join(out, 'one.js'), inline(named, 'one'));
let kb = 0;
const capped = [...named, ...readdirSync(dir).filter((f) => f.endsWith('.js') && !named.includes(f))]
  .filter((file) => (kb += readFileSync(join(dir, file)).length / 1024) <= Number(cap) || named.includes(file));
writeFileSync(join(out, 'all.js'), inline(capped, 'all'));
for (const name of ['split.js', 'one.js', 'all.js']) console.log(name, Math.round(readFileSync(join(out, name)).length / 1024), 'kB');
console.log(marker);
