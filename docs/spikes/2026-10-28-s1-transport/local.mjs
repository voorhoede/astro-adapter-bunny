// usage: deno run -A local.mjs <built script> <route> [requests]; runs a built script locally with a stub Bunny.v1.serve
let handler;
globalThis.Bunny = { v1: { serve: (fn) => { handler = fn; } } };
const [file, route, n = '2'] = Deno.args;
const start = performance.now();
(0, eval)(await Deno.readTextFile(file));
console.log('boot ms', +(performance.now() - start).toFixed(1));
for (let i = 0; i < Number(n); i++) {
  const t = performance.now();
  const response = await handler(new Request(`http://localhost/?route=${route}`));
  const body = await response.json();
  console.log(+(performance.now() - t).toFixed(1), 'ms', JSON.stringify({ ...body, parts: body.parts.map((p) => `${p.name}:${p.ms}`).join(' ') }));
}
