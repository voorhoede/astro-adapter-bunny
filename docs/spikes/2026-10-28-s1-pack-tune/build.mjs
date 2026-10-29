// usage: node build.mjs <parts dir> <server dir> <s.js path> <out dir> <route part>[,...]
// Writes eight standalone scripts over one set of System.register parts (entry `entry.js`), each answering JSON timings
// for ?route=<path> (rendered with `module.default.fetch(request)`), the HTML itself with &html=1, runtime checks for
// ?check=1, and 404 otherwise:
//   one      the entry, its static closure and the route parts as functions, nothing else
//   packed   S1 packed: the other parts gzip 9 + base64 string literals, atob + Uint8Array.from, DecompressionStream
//   fb64     as packed with Uint8Array.fromBase64, and Shiki's base64 wasm literal packed as gzipped bytes
//   brotli   as fb64 with brotli 11
//   comment  as brotli with the packed data in a function body comment read with toString(), and the manifest's
//            entryModules entries that point at files in <server dir> removed (fails on bunny.net, which drops comments)
//   manifest as comment with the packed data in string literals
//   minify   as manifest with every part minified by oxc, function and class names kept
//   mingz    as minify with gzip 9 instead of brotli
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { minify } from 'rolldown/utils';

const [dir, serverDir, sjs, out, route] = process.argv.slice(2);
const marker = `pt-${Date.now()}`;
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
const routeParts = route.split(',');
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

const compress = {
  gzip: (data) => gzipSync(data, { level: 9 }),
  brotli: (data) => brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }),
};

async function partsOf(v) {
  const parts = new Map();
  let wasmBytes;
  for (const file of files) {
    let text = readFileSync(join(dir, file), 'utf8');
    if (v.manifest) text = stripManifest(text);
    if (v.wasm && file === WASM) {
      wasmBytes = Buffer.from(text.match(WASM_DECODE)[1], 'base64');
      text = text.replace(WASM_DECODE, 'globalThis.__packedBytes[0]');
    }
    if (v.minify) {
      const result = await minify(file, text, { compress: { keepNames: { function: true, class: true } }, mangle: { keepNames: true } });
      if (result.errors?.length) throw new Error(`${file} ${JSON.stringify(result.errors[0])}`);
      text = result.code;
    }
    parts.set(file, text);
  }
  return { parts, wasmBytes };
}

const variants = [
  { name: 'one', inline: [...eager, ...routeParts], keep: [] },
  { name: 'packed', decode: 'from', compress: 'gzip' },
  { name: 'fb64', decode: 'fromBase64', compress: 'gzip', wasm: true },
  { name: 'brotli', decode: 'fromBase64', compress: 'brotli', wasm: true },
  { name: 'comment', decode: 'fromBase64', compress: 'brotli', wasm: true, comment: true, manifest: true },
  { name: 'manifest', decode: 'fromBase64', compress: 'brotli', wasm: true, manifest: true },
  { name: 'minify', decode: 'fromBase64', compress: 'brotli', wasm: true, manifest: true, minify: true },
  { name: 'mingz', decode: 'fromBase64', compress: 'gzip', wasm: true, manifest: true, minify: true },
];

const decoders = {
  from: '(s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))',
  fromBase64: '(s) => Uint8Array.fromBase64(s)',
};

const checkSample = { gzip: gzipSync('hello packed').toString('base64'), brotli: compress.brotli(Buffer.from('hello packed')).toString('base64') };

async function build(v) {
  const { parts, wasmBytes } = await partsOf(v);
  const inline = v.inline ?? eager;
  const packedFiles = v.keep ?? files.filter((file) => !inline.includes(file));
  const data = new Map(packedFiles.map((file) => [file, compress[v.compress](Buffer.from(parts.get(file))).toString('base64')]));
  if (wasmBytes) data.set('wasm-bytes', compress[v.compress](wasmBytes).toString('base64'));
  let table;
  let comment = '';
  if (v.comment) {
    let body = 'function packedSource() {/*\n';
    const index = {};
    for (const [file, b64] of data) { index[file] = [body.length, b64.length]; body += `${b64}\n`; }
    comment = `${body}*/}\n`;
    table = JSON.stringify(index);
  } else {
    table = JSON.stringify(Object.fromEntries(data));
  }
  const format = v.compress === 'brotli' ? 'brotli' : 'gzip';
  const source = `const scriptStart = performance.now();
${systemjs}
const isolate = crypto.randomUUID().slice(0, 8);
const bootedAt = Date.now();
const noStore = { 'cache-control': 'private, no-store' };
const ms = (n) => +n.toFixed(1);
const base = 'https://parts.invalid/';
let count = 0;
let appImported = false;
let log = [];
globalThis.__packedBytes = [];
const inline = {
${inline.map((file) => `${JSON.stringify(file)}: function () {\n${parts.get(file)}\n},`).join('\n')}
};
const packed = ${table};
${comment}${v.comment
    ? 'let packedText;\nconst dataOf = (name) => { const [offset, length] = packed[name]; return (packedText ??= packedSource.toString()).slice(offset, offset + length); };'
    : 'const dataOf = (name) => packed[name];'}
const decode = ${decoders[v.decode ?? 'from']};
const inflate = (bytes) => new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('${format}')));
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
    if (${JSON.stringify(v.wasm && WASM)} === name) {
      const t = performance.now();
      globalThis.__packedBytes[0] = new Uint8Array(await inflate(decode(dataOf('wasm-bytes'))).arrayBuffer());
      rec.bytesMs = ms(performance.now() - t);
    }
    const text = ${v.decode === 'fromBase64' ? 'utf8.decode(await inflate(decode(dataOf(name))).arrayBuffer())' : 'await inflate(decode(dataOf(name))).text()'};
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
async function check() {
  const first = count === 1 && !appImported;
  const out = { variant: '${v.name}', deno: globalThis.Deno?.version, first, fromBase64: typeof Uint8Array.fromBase64 };
  let t = performance.now();
  'about'.localeCompare('code');
  out.firstLocaleCompareMs = ms(performance.now() - t);
  t = performance.now();
  new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  out.firstDateTimeFormatMs = ms(performance.now() - t);
  t = performance.now();
  'code'.localeCompare('about');
  out.secondLocaleCompareMs = ms(performance.now() - t);
  out.locale = new Intl.DateTimeFormat().resolvedOptions().locale;
  for (const format of ['gzip', 'brotli']) {
    try {
      const bytes = Uint8Array.from(atob(${JSON.stringify(checkSample)}[format]), (c) => c.charCodeAt(0));
      out[format] = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format))).text();
    } catch (error) { out[format] = 'error: ' + String(error); }
  }
  function sample() {/*
0123456789abcdefghijklmnopqrstuvwxyz
*/}
  out.toStringSample = sample.toString().includes('abcdefghij');
  ${v.comment ? `t = performance.now();
  const fresh = packedText === undefined;
  const whole = packedSource.toString();
  out.packedToString = { fresh, ms: ms(performance.now() - t), chars: whole.length, ok: whole.length === ${comment.length - 1} && whole.endsWith('*/}') };` : ''}
  try { out.nodeZlib = typeof (await import('node:zlib')).brotliDecompressSync; } catch (error) { out.nodeZlib = 'error: ' + String(error).slice(0, 80); }
  return out;
}
const scriptMs = ms(performance.now() - scriptStart);
Bunny.v1.serve(async (request) => {
  if (request.headers.has('x-spike-wait')) return Response.json({ marker: '${marker}-${v.name}' }, { headers: noStore });
  const url = new URL(request.url);
  count++;
  if (url.searchParams.has('check')) return Response.json(await check(), { headers: noStore });
  if (!url.searchParams.has('route')) return new Response('not found', { status: 404, headers: noStore });
  const info = { variant: '${v.name}', isolate, count, scriptStartMs: ms(scriptStart), scriptMs, bootAgeMs: Date.now() - bootedAt, pop: request.headers.get('cdn-serverzone') };
  try {
    log = [];
    const start = performance.now();
    const module = await System.import(base + ${JSON.stringify(ENTRY)});
    appImported = true;
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
