// usage: deno run --allow-read --allow-env local.mjs <built script> <routes file>
// Loads the script with a stub Bunny.v1.serve, as test/harness/runner.js does, requests every route in order and
// prints one JSON line: load time, Deno.memoryUsage() after loading, after the first route and after all, and per
// route the status, time and body SHA-256 (with the spike's response headers left out).
const [script, routesFile] = Deno.args;
const routes = (await Deno.readTextFile(routesFile)).trim().split('\n');
let handler;
globalThis.Bunny = { v1: { serve: (fetch) => (handler = fetch) } };
const mb = () => { const m = Deno.memoryUsage(); return { rss: +(m.rss / 2 ** 20).toFixed(1), heapUsed: +(m.heapUsed / 2 ** 20).toFixed(1) }; };
const sha = async (text) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const t0 = performance.now();
await import(new URL(script, `file://${Deno.cwd()}/`).href);
const loadMs = +(performance.now() - t0).toFixed(1);
const memory = { loaded: mb() };
const results = [];
for (const [i, path] of routes.entries()) {
  const t = performance.now();
  const response = await handler(new Request(new URL(path, 'https://example.com')));
  const body = await response.text();
  results.push({ path, status: response.status, ms: +(performance.now() - t).toFixed(1), sha: await sha(body) });
  if (i === 0) memory.first = mb();
}
memory.all = mb();
globalThis.gc?.();
memory.allAfterGc = mb();
console.log(JSON.stringify({ script, loadMs, memory, results }));
