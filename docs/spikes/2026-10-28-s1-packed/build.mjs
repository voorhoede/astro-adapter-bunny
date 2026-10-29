// usage: node build.mjs <parts dir> <out dir> <entry> <eager part>[,...] <route part>[,...]
// Writes three standalone scripts that answer JSON timings (?route=<path> renders with `module.default.fetch(request)`
// under SystemJS; without it, 404; ?check=1 reports whether DecompressionStream('gzip') works):
// <out>/packed.js registers the entry and eager parts as functions and holds every other part gzip + base64 encoded,
// unpacked with DecompressionStream and evaluated on first import; <out>/one.js registers the entry, eager and route
// parts as functions (the transport spike's variant C); <out>/fn.js holds generated functions up to packed.js's size.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const [dir, out, entry, eager, route] = process.argv.slice(2);
const marker = `pk-${Date.now()}`;
const systemjs = readFileSync(createRequire(import.meta.url).resolve('systemjs/dist/system.min.js'), 'utf8');
const read = (file) => readFileSync(join(dir, file), 'utf8');
mkdirSync(out, { recursive: true });

const prelude = (variant) => `
const bootPerfMs = +performance.now().toFixed(1);
const bootedAt = Date.now();
const isolate = crypto.randomUUID().slice(0, 8);
const noStore = { 'cache-control': 'private, no-store' };
const ms = (n) => +n.toFixed(1);
let count = 0;
async function check() {
  const out = { variant: '${variant}', deno: globalThis.Deno?.version, decompressionStream: typeof DecompressionStream };
  try {
    const bytes = Uint8Array.from(atob(${JSON.stringify(gzipSync('hello packed').toString('base64'))}), (c) => c.charCodeAt(0));
    out.gunzip = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } catch (error) { out.gunzip = 'error: ' + String(error); }
  return out;
}
`;

const serve = (variant, render) => `
Bunny.v1.serve(async (request) => {
  if (request.headers.has('x-spike-wait')) return Response.json({ marker: '${marker}-${variant}' }, { headers: noStore });
  const url = new URL(request.url);
  if (url.searchParams.has('check')) return Response.json(await check(), { headers: noStore });
  if (!url.searchParams.has('route')) return new Response('not found', { status: 404, headers: noStore });
  count++;
  const info = { variant: '${variant}', isolate, count, bootPerfMs, bootAgeMs: Date.now() - bootedAt, pop: request.headers.get('cdn-serverzone') };
  try {
    return Response.json({ ...info, ...(await (${render})(url)) }, { headers: noStore });
  } catch (error) {
    return Response.json({ ...info, error: String(error?.stack ?? error).slice(0, 600) }, { status: 500, headers: noStore });
  }
});
`;

const renderWith = `async (url) => {
  log = [];
  const start = performance.now();
  const module = await (shared ??= new System.constructor()).import(base + ${JSON.stringify(entry)});
  const eagerMs = performance.now() - start;
  const response = await module.default.fetch(new Request(new URL(url.searchParams.get('route'), url)));
  const body = await response.text();
  return { status: response.status, bodyBytes: body.length, eagerMs: ms(eagerMs), renderMs: ms(performance.now() - start - eagerMs), runMs: ms(performance.now() - start), parts: log };
}`;

const functions = (files) => files.map((file) => `${JSON.stringify(file)}: function () {\n${read(file)}\n},`).join('\n');

const loader = (variant, inline, packed) => `${systemjs}
${prelude(variant)}
const base = 'https://parts.invalid/';
let shared;
let log = [];
const inline = {
${functions(inline)}
};
const packed = {
${packed.map((file) => `${JSON.stringify(file)}: ${JSON.stringify(gzipSync(read(file), { level: 9 }).toString('base64'))},`).join('\n')}
};
const unpack = (data) => new Response(new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
const short = (name) => name.slice(0, 16);
System.constructor.prototype.instantiate = function (url) {
  const name = url.slice(base.length);
  const start = performance.now();
  if (inline[name]) {
    inline[name]();
    log.push({ name: short(name), ms: ms(performance.now() - start) });
    return this.getRegister(url);
  }
  if (!packed[name]) throw new Error('unknown part ' + name);
  return unpack(packed[name]).then((text) => {
    const evalStart = performance.now();
    (0, eval)(text);
    log.push({ name: short(name), unpackMs: ms(evalStart - start), evalMs: ms(performance.now() - evalStart), at: ms(start) });
    return this.getRegister(url);
  });
};
${serve(variant, renderWith)}`;

const files = readdirSync(dir).filter((file) => file.endsWith('.js'));
const eagerFiles = [entry, ...eager.split(',')];
writeFileSync(join(out, 'packed.js'), loader('packed', eagerFiles, files.filter((file) => !eagerFiles.includes(file))));
writeFileSync(join(out, 'one.js'), loader('one', [...eagerFiles, ...route.split(',')], []));

const target = readFileSync(join(out, 'packed.js')).length;
let generated = '';
for (let i = 0; generated.length < target; i++) {
  generated += `function f${i}(a, b) { const c = a * ${i} + b; if (c % 7 === ${i % 7}) { return [c, a, b].map((x) => x + ${i}).join('-'); } return c > ${i} ? f${i}(b, a - 1) : String(c); }\n`;
}
writeFileSync(join(out, 'fn.js'), `${generated}${prelude('fn')}${serve('fn', 'async () => ({ check: f1(3, 4) })')}`);

for (const name of ['packed.js', 'one.js', 'fn.js']) console.log(name, readFileSync(join(out, name)).length, 'bytes');
console.log(marker);
