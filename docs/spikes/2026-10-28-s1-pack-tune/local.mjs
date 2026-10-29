// usage: deno run -A local.mjs <built script> <query> [requests]; evaluates a built script with a stub Bunny.v1.serve
// in a fresh process and prints the evaluation time and each response
let handler;
globalThis.Bunny = { v1: { serve: (fn) => { handler = fn; } } };
const [file, query, n = '1'] = Deno.args;
const start = performance.now();
(0, eval)(await Deno.readTextFile(file));
console.log('eval ms', +(performance.now() - start).toFixed(1));
for (let i = 0; i < Number(n); i++) {
  const t = performance.now();
  const response = await handler(new Request(`http://localhost/?${query}`));
  const text = await response.text();
  console.log(+(performance.now() - t).toFixed(1), 'ms', response.status, text.length > 2000 ? `${text.length} chars` : text);
}
