// usage: node files.mjs <dir>; writes the storage fixtures for steps 3a, 4 and 6
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
const out = process.argv[2];
const write = (path, body) => { mkdirSync(dirname(join(out, path)), { recursive: true }); writeFileSync(join(out, path), body); };
let part = '';
for (let i = 0; part.length < 200 * 1024; i++) part += `function f${i}(a) { return a * ${i} + ${i % 13}; }\n`;
write('_bunny/server/p200k.js', part);
write('t/a.css', 'body { color: red; }\n');
write('t/a.js', 'export const a = 1;\n');
write('t/a.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>\n');
write('t/a.webmanifest', '{"name":"spike"}\n');
write('t/a.html', '<!doctype html><title>spike</title>\n' + 'x'.repeat(2000) + '\n');
write('t/noext', 'no extension\n');
write('pre/page.html', '<!doctype html><title>prefixed</title>\n');
write('page.html', '<!doctype html><title>unprefixed</title>\n');
