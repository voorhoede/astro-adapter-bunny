// usage: deno run --allow-read --allow-env trace.mjs <parts dir> <entry file> <route>
// Renders <route> locally under SystemJS with parts read from disk and prints which parts load, in which phase.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [dir, entry, route] = Deno.args;
(0, eval)(readFileSync(createRequire(import.meta.url).resolve('systemjs/dist/system.min.js'), 'utf8'));
const base = 'https://parts.local/';
const log = [];
let phase = 'eager';
const proto = System.constructor.prototype;
proto.shouldFetch = () => true;
proto.fetch = async (url) => {
  const file = url.slice(base.length);
  const text = readFileSync(join(dir, file), 'utf8');
  log.push({ file, bytes: Buffer.byteLength(text), phase });
  await new Promise((resolve) => setTimeout(resolve, 5));
  return new Response(text, { headers: { 'content-type': 'application/javascript' } });
};
const module = await System.import(base + entry);
phase = 'route';
const response = await module.default.fetch(new Request(`http://localhost${route}`));
const body = await response.text();
console.log(JSON.stringify({ route, status: response.status, bodyBytes: body.length, files: log }, null, 1));
