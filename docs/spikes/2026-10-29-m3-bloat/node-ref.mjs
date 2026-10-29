// usage: node node-ref.mjs <app dir> <routes file>; renders every route from dist/server/entry.mjs under Node and
// prints one JSON line with the status and body SHA-256 per route, to compare with local.mjs.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [app, routesFile] = process.argv.slice(2);
const server = await import(resolve(join(app, 'dist/server/entry.mjs')));
const results = [];
for (const path of readFileSync(routesFile, 'utf8').trim().split('\n')) {
  const response = await server.default.fetch(new Request(new URL(path, 'https://example.com')));
  results.push({ path, status: response.status, sha: createHash('sha256').update(await response.text()).digest('hex') });
}
console.log(JSON.stringify({ results }));
