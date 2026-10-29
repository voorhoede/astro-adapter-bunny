// usage: node pack.mjs <app dir> <out file>
// Packs <app dir>/dist/server with the adapter's own bundle() and writes the script, without the 7 MB check the
// integration applies, so sizes above it can be deployed. Prints sizes as one JSON line.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundle } from '../../../src/build/bundle.ts';

const [app, out] = process.argv.slice(2);
const server = join(app, 'dist/server');
const files = readdirSync(server, { recursive: true }).map((f) => join(server, f)).filter((f) => statSync(f).isFile());
const serverBytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
const jsBytes = files.filter((f) => /\.m?js$/.test(f)).reduce((sum, f) => sum + statSync(f).size, 0);
const start = performance.now();
const logger = { info: () => {}, debug: () => {}, warn: (m) => console.error('warn', m), error: (m) => console.error('error', m) };
const script = await bundle({ dir: server, entry: 'entry.mjs', logger });
const ms = Math.round(performance.now() - start);
writeFileSync(out, script.code);
const code = script.code;
const packedAt = code.indexOf('\npacked: ');
const wasmAt = code.indexOf('\nwasm: ');
const inlineAt = code.indexOf('\ninline: {');
console.log(JSON.stringify({
  out, serverBytes, serverJsBytes: jsBytes, serverFiles: files.length, scriptBytes: Buffer.byteLength(code),
  eagerBytes: packedAt - inlineAt, packedBytes: wasmAt - packedAt, lazyChunks: (code.slice(packedAt, wasmAt).match(/":"/g) ?? []).length,
  builtins: script.builtins, bundleMs: ms,
  bundleTs: createHash('sha256').update(readFileSync(new URL('../../../src/build/bundle.ts', import.meta.url))).digest('hex').slice(0, 12),
}));
