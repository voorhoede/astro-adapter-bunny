// usage: node split.mjs <out dir> <kB per module>; step 3c
// Writes four generated modules (entry imports a and d dynamically, both import b), then builds them twice:
// <out>/single.js, one ES module with the handler, and <out>/split.js, system.min.js plus a loader for <out>/parts/*.js.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { rollup } from 'rollup';

const [out, kb = '250'] = process.argv.slice(2);
const src = join(out, 'src');
mkdirSync(src, { recursive: true });
const filler = (prefix) => {
  let code = '';
  const names = [];
  for (let i = 0; code.length < Number(kb) * 1024; i++) {
    code += `function ${prefix}${i}(x, y) { const z = x * ${i} + y; if (z % 7 === ${i % 7}) { return [z, x, y].map((v) => v + ${i}).join('-'); } return z > ${i} ? ${prefix}${i}(y, x - 1) : String(z); }\n`;
    names.push(`${prefix}${i}`);
  }
  return `${code}globalThis.kept = (globalThis.kept ?? 0) + [${names.join(',')}].length;\n`;
};
writeFileSync(join(src, 'b.js'), `${filler('b')}export function b() { return b1(3, 4); }\n`);
writeFileSync(join(src, 'a.js'), `import { b } from './b.js';\n${filler('a')}export function a() { return a1(3, 4) + b(); }\n`);
writeFileSync(join(src, 'd.js'), `import { b } from './b.js';\n${filler('d')}export function d() { return d1(3, 4) + b(); }\n`);
writeFileSync(join(src, 'entry.js'), `${filler('e')}export async function run() {\n  const [{ a }, { d }] = await Promise.all([import('./a.js'), import('./d.js')]);\n  return e1(3, 4) + a() + d();\n}\n`);

const marker = `split-${Date.now()}`;
const handlerTail = (variant, body) => `
const isolate = crypto.randomUUID().slice(0, 8);
let count = 0;
Bunny.v1.serve(async (request) => {
  if (request.headers.has('x-spike-wait')) return Response.json({ marker: '${marker}-${variant}' }, { headers: { 'cache-control': 'private, no-store' } });
  count++;
  const start = performance.now();
  try {
${body}
  } catch (error) {
    return Response.json({ isolate, count, error: String(error?.stack ?? error) }, { status: 500, headers: { 'cache-control': 'private, no-store' } });
  }
});
`;

const single = await rollup({ input: join(src, 'entry.js') });
const { output: [singleChunk] } = await single.generate({ format: 'es', inlineDynamicImports: true });
writeFileSync(join(out, 'single.js'), singleChunk.code.replace(/^export \{[^}]*\};?\s*$/m, '') + handlerTail('single', `
    const result = await run();
    return Response.json({ variant: 'single', isolate, count, runMs: +(performance.now() - start).toFixed(1), result: result.length }, { headers: { 'cache-control': 'private, no-store' } });`));

const split = await rollup({ input: join(src, 'entry.js') });
await split.write({ dir: join(out, 'parts'), format: 'system', entryFileNames: '[name].js', chunkFileNames: '[name].js' });
const systemjs = readFileSync(createRequire(import.meta.url).resolve('systemjs/dist/system.min.js'), 'utf8');
writeFileSync(join(out, 'split.js'), `${systemjs}
const env = (name) => Deno.env.get(name) ?? '';
const log = [];
const proto = System.constructor.prototype;
proto.shouldFetch = () => true;
proto.fetch = async (url) => {
  const name = url.slice(url.lastIndexOf('/') + 1);
  const start = performance.now();
  const cache = await caches.open('parts');
  const key = new URL(url).pathname;
  let body;
  let hit = false;
  if (cacheHost) {
    const cached = await cache.match(\`https://\${cacheHost}\${key}\`);
    if (cached) { body = await cached.text(); hit = true; }
  }
  if (!hit) {
    const response = await fetch(url, { headers: { AccessKey: env('STORAGE_KEY') } });
    body = await response.text();
    if (cacheHost && response.ok) await cache.put(\`https://\${cacheHost}\${key}\`, new Response(body, { headers: { 'cache-control': 'public, max-age=31536000' } }));
  }
  log.push({ name, hit, ms: +(performance.now() - start).toFixed(1) });
  return new Response(body, { headers: { 'content-type': 'application/javascript' } });
};
let cacheHost = '';
${handlerTail('split', `
    cacheHost = new URL(request.url).searchParams.get('nocache') ? '' : request.headers.get('host');
    const before = log.length;
    const module = await System.import(\`\${env('STORAGE_BASE')}/_bunny/server/3c/entry.js\`);
    const result = await module.run();
    return Response.json({ variant: 'split', isolate, count, runMs: +(performance.now() - start).toFixed(1), result: result.length, parts: log.slice(before) }, { headers: { 'cache-control': 'private, no-store' } });`)}`);
console.log(marker);
