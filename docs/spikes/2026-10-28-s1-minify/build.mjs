// usage: [OXC_MINIFY=<path to oxc-minify's index.js>] node build.mjs <parts dir> <server dir> <s.js path> <out dir>
// Writes three standalone scripts over one set of System.register parts (entry `entry.js`), each answering JSON timings
// for ?route=<path> (rendered with `module.default.fetch(request)`), the HTML itself with &html=1, and 404 otherwise.
// All three: brotli 11, Uint8Array.fromBase64, Shiki's base64 wasm literal packed as bytes, the manifest's entryModules
// entries that point at files in <server dir> removed, packed data in string literals (S1 pack tune variant 5).
//   v5   no minify
//   v6r  every part minified with Rolldown's own minifier (rolldown/utils), names kept, legal comments kept inline
//   v6o  every part minified with the oxc-minify package (S1 pack tune variant 6's options), names kept; skipped
//        when OXC_MINIFY is not set
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { minify as rolldownMinify } from 'rolldown/utils';

const oxcMinify = process.env.OXC_MINIFY && (await import(process.env.OXC_MINIFY)).minify;

const [dir, serverDir, sjs, out] = process.argv.slice(2);
const marker = `mn-${Date.now()}`;
const systemjs = readFileSync(sjs, 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, '');
const files = readdirSync(dir).filter((file) => file.endsWith('.js'));
const ENTRY = 'entry.js';
const WASM_DECODE = /Uint8Array\.from\(atob\("([^"]+)"\), \(c\) => c\.charCodeAt\(0\)\)/;
mkdirSync(out, { recursive: true });

const depsOf = (file) => JSON.parse(readFileSync(join(dir, file), 'utf8').match(/^System\.register\((\[[^\]]*\])/)[1].replaceAll("'", '"'));
const closure = (file, seen = new Set()) => {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const dep of depsOf(file)) closure(dep.replace(/^\.\//, ''), seen);
  return seen;
};
const eager = [...closure(ENTRY)];
const wasmParts = files.filter((file) => WASM_DECODE.test(readFileSync(join(dir, file), 'utf8')));
if (wasmParts.length !== 1) throw new Error(`expected one Shiki wasm part, found ${wasmParts.length}`);
const [WASM] = wasmParts;

const stripManifest = (code) => {
  const start = code.indexOf('deserializeManifest({');
  if (start === -1) return code;
  const i = start + 'deserializeManifest('.length;
  const end = endOfLiteral(code, i);
  const manifest = JSON.parse(code.slice(i, end));
  manifest.entryModules = Object.fromEntries(
    Object.entries(manifest.entryModules).filter(([, file]) => !(file && existsSync(join(serverDir, file)))),
  );
  return code.slice(0, i) + JSON.stringify(manifest) + code.slice(end);
};

function endOfLiteral(code, i) {
  let depth = 0;
  for (let j = i; j < code.length; j++) {
    const c = code[j];
    if (c === '"') {
      for (j++; code[j] !== '"'; j++) if (code[j] === '\\') j++;
    } else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      if (--depth === 0) return j + 1;
    }
  }
  throw new Error('unterminated manifest literal');
}

const brotli = (data) => brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } });

const keepNames = { compress: { keepNames: { function: true, class: true } }, mangle: { keepNames: true } };

async function partsOf(v) {
  const parts = new Map();
  let wasmBytes;
  for (const file of files) {
    let text = readFileSync(join(dir, file), 'utf8');
    text = stripManifest(text);
    if (file === WASM) {
      wasmBytes = Buffer.from(text.match(WASM_DECODE)[1], 'base64');
      text = text.replace(WASM_DECODE, 'globalThis.__packedBytes[0]');
    }
    if (v.minify) {
      const result = await v.minify(file, text, { ...keepNames, ...v.options });
      if (result.errors?.length) throw new Error(`${file} ${JSON.stringify(result.errors[0])}`);
      text = result.code;
    }
    parts.set(file, text);
  }
  return { parts, wasmBytes };
}

const variants = [
  { name: 'v5' },
  { name: 'v6r', minify: rolldownMinify, options: { codegen: { legalComments: 'inline' } } },
  ...(oxcMinify ? [{ name: 'v6o', minify: oxcMinify }] : []),
];

async function build(v) {
  const { parts, wasmBytes } = await partsOf(v);
  const packedFiles = files.filter((file) => !eager.includes(file));
  const data = new Map(packedFiles.map((file) => [file, brotli(Buffer.from(parts.get(file))).toString('base64')]));
  data.set('wasm-bytes', brotli(wasmBytes).toString('base64'));
  const table = JSON.stringify(Object.fromEntries(data));
  const source = `const scriptStart = performance.now();
${systemjs}
const isolate = crypto.randomUUID().slice(0, 8);
const bootedAt = Date.now();
const noStore = { 'cache-control': 'private, no-store' };
const ms = (n) => +n.toFixed(1);
const base = 'https://parts.invalid/';
let count = 0;
let log = [];
globalThis.__packedBytes = [];
const inline = {
${eager.map((file) => `${JSON.stringify(file)}: function () {\n${parts.get(file)}\n},`).join('\n')}
};
const packed = ${table};
const dataOf = (name) => packed[name];
const decode = (s) => Uint8Array.fromBase64(s);
const inflate = (bytes) => new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('brotli')));
const utf8 = new TextDecoder();
const short = (name) => name.slice(0, 12);
System.constructor.prototype.instantiate = function (url) {
  const name = url.slice(base.length);
  const start = performance.now();
  if (inline[name]) {
    inline[name]();
    log.push({ name: short(name), evalMs: ms(performance.now() - start) });
    return this.getRegister(url);
  }
  if (!(name in packed)) throw new Error('unknown part ' + name);
  return (async () => {
    const rec = { name: short(name) };
    if (${JSON.stringify(WASM)} === name) {
      const t = performance.now();
      globalThis.__packedBytes[0] = new Uint8Array(await inflate(decode(dataOf('wasm-bytes'))).arrayBuffer());
      rec.bytesMs = ms(performance.now() - t);
    }
    const text = utf8.decode(await inflate(decode(dataOf(name))).arrayBuffer());
    const evalStart = performance.now();
    (0, eval)(text);
    rec.unpackMs = ms(evalStart - start);
    rec.evalMs = ms(performance.now() - evalStart);
    log.push(rec);
    return this.getRegister(url);
  })();
};
const sha = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
  text.replace(/([?&](?:amp;)?e=)[^&"]*/g, '$1X').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'U'),
))), (b) => b.toString(16).padStart(2, '0')).join('');
const scriptMs = ms(performance.now() - scriptStart);
Bunny.v1.serve(async (request) => {
  if (request.headers.has('x-spike-wait')) return Response.json({ marker: '${marker}-${v.name}' }, { headers: noStore });
  const url = new URL(request.url);
  count++;
  if (!url.searchParams.has('route')) return new Response('not found', { status: 404, headers: noStore });
  const info = { variant: '${v.name}', isolate, count, scriptStartMs: ms(scriptStart), scriptMs, bootAgeMs: Date.now() - bootedAt, pop: request.headers.get('cdn-serverzone') };
  try {
    log = [];
    const start = performance.now();
    const module = await System.import(base + ${JSON.stringify(ENTRY)});
    const eagerMs = performance.now() - start;
    const response = await module.default.fetch(new Request(new URL(url.searchParams.get('route'), url)));
    const body = await response.text();
    const runMs = performance.now() - start;
    if (url.searchParams.has('html')) return new Response(body, { status: response.status, headers: { ...noStore, 'content-type': 'text/html' } });
    const unpackMs = log.reduce((s, p) => s + (p.unpackMs ?? 0), 0);
    return Response.json({ ...info, status: response.status, bodyBytes: body.length, sha: (await sha(body)).slice(0, 16),
      eagerMs: ms(eagerMs), renderMs: ms(runMs - eagerMs), runMs: ms(runMs), unpackMs: ms(unpackMs), parts: log }, { headers: noStore });
  } catch (error) {
    return Response.json({ ...info, error: String(error?.stack ?? error).slice(0, 600) }, { status: 500, headers: noStore });
  }
});
`;
  writeFileSync(join(out, `${v.name}.js`), source);
  console.log(v.name.padEnd(8), String(Buffer.byteLength(source)).padStart(9), 'bytes');
}

for (const v of variants) await build(v);
console.log(marker);
