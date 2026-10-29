// usage: node sizes.mjs <built script>...
// Prints each script's size, its eager part (the parts registered as functions), the packed table, and the packed parts
// and wasm bytes once decompressed, in bytes.
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';

for (const file of process.argv.slice(2)) {
  const source = readFileSync(file, 'utf8');
  const inline = source.indexOf('const inline = {');
  const table = source.indexOf('const packed = ');
  const tableEnd = source.indexOf('\n', table);
  const packed = JSON.parse(source.slice(table + 'const packed = '.length, tableEnd - 1));
  const unpacked = Object.entries(packed).map(([name, b64]) => [name, brotliDecompressSync(Buffer.from(b64, 'base64')).length]);
  console.log(file.split('/').pop(), {
    script: Buffer.byteLength(source),
    eager: Buffer.byteLength(source.slice(inline, table)),
    packedTable: tableEnd - table,
    packedParts: unpacked.filter(([name]) => name !== 'wasm-bytes').reduce((sum, [, n]) => sum + n, 0),
    wasmBytes: unpacked.find(([name]) => name === 'wasm-bytes')?.[1],
  });
}
