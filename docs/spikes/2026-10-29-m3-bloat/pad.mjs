// usage: node pad.mjs <bytes> <out file> [random]; writes a valid script of about <bytes> whose bulk is one string
// literal (repeated, or random base64 when "random" is given), to test publish acceptance by size alone.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [bytes, out, kind] = process.argv.slice(2);
const n = Number(bytes) - 200;
const data = kind === 'random' ? randomBytes(Math.ceil(n * 0.75)).toString('base64').slice(0, n) : 'A'.repeat(n);
writeFileSync(out, `const pad = "${data}";\nBunny.v1.serve(() => new Response('pad ' + pad.length, { headers: { 'cache-control': 'no-store' } }));\n`);
