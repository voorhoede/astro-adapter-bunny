import { readFileSync, writeFileSync } from 'node:fs';
const [kind, arg] = process.argv.slice(2);
const marker = `${kind}-${arg}-${Date.now()}`;
const respond = (body) => `Bunny.v1.serve(async () => Response.json(${body}, { headers: { 'cache-control': 'private, no-store' } }));\n`;
let code = '';
if (kind === 'builtin') {
  code += arg === 'control'
    ? "import path from 'node:path';\nimport { Buffer } from 'node:buffer';\nimport crypto from 'node:crypto';\n"
    : `import * as probe from 'node:${arg}';\n`;
  const wasmChunk = readFileSync(process.env.WASM_CHUNK, 'utf8');
  const base64 = /atob\("([A-Za-z0-9+/=]+)"\)/.exec(wasmChunk)[1];
  code += `const shikiWasm = ${JSON.stringify(base64)};\n`;
  code += respond(`await (async () => {
    const out = { marker: ${JSON.stringify(marker)}, deno: typeof Deno !== 'undefined' ? Deno.version : null };
    try { const tiny = new Uint8Array([0,97,115,109,1,0,0,0]); out.wasmTiny = String(WebAssembly.validate(tiny)) + '/' + typeof (await WebAssembly.instantiate(tiny)).instance; } catch (e) { out.wasmTiny = 'error: ' + e.message; }
    try { const bytes = Uint8Array.from(atob(shikiWasm), (c) => c.charCodeAt(0)); const t = performance.now(); const m = await WebAssembly.compile(bytes); out.wasmShiki = 'compiled ' + bytes.length + ' bytes in ' + (performance.now() - t).toFixed(1) + ' ms, exports ' + WebAssembly.Module.exports(m).length; } catch (e) { out.wasmShiki = 'error: ' + e.message; }
    ${arg === 'control' ? "out.builtins = { path: path.join('a', 'b'), buffer: Buffer.from('hi').toString('base64'), crypto: typeof crypto.createHash };" : `out.imported = Object.keys(probe).length;`}
    return out;
  })()`);
} else {
  const target = Number(arg) * 1024 * 1024;
  let i = 0;
  const parts = [];
  let size = 0;
  while (size < target) {
    const fn = `function f${i}(a, b) { const c = a * ${i} + b; if (c % 7 === ${i % 7}) { return [c, a, b].map((x) => x + ${i}).join('-'); } return c > ${i} ? f${i}(b, a - 1) : String(c); }\n`;
    parts.push(fn); size += fn.length; i++;
  }
  code += parts.join('');
  code += `const count = ${i};\n`;
  code += respond(`{ marker: ${JSON.stringify(marker)}, functions: count, check: f1(3, 4) }`);
}
writeFileSync('main.js', code);
console.log(marker, (Buffer.byteLength(code) / 1024 / 1024).toFixed(2) + ' MB');
