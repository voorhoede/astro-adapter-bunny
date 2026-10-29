const BASE = Deno.env.get('BASE');
const ROUTE = Deno.env.get('ROUTE');
const log = [];
const proto = System.constructor.prototype;
proto.shouldFetch = () => true;
proto.fetch = async (url) => {
  const response = await fetch(url);
  const text = await response.text();
  log.push({ file: url.slice(BASE.length), bytes: text.length, phase: phase });
  return new Response(text, { status: response.status, headers: { 'content-type': 'application/javascript' } });
};
let phase = 'eager';
const entry = Deno.env.get('ENTRY');
const t0 = performance.now();
const module = await System.import(BASE + entry);
const t1 = performance.now();
phase = 'route';
const response = await module.default.fetch(new Request('http://localhost' + ROUTE));
const body = await response.text();
const t2 = performance.now();
const sum = (p) => log.filter((l) => l.phase === p);
console.log(JSON.stringify({
  route: ROUTE, status: response.status, bodyBytes: body.length,
  eager: { files: sum('eager').length, kB: Math.round(sum('eager').reduce((s, l) => s + l.bytes, 0) / 1024), ms: Math.round(t1 - t0) },
  route_: { files: sum('route').length, kB: Math.round(sum('route').reduce((s, l) => s + l.bytes, 0) / 1024), ms: Math.round(t2 - t1), names: sum('route').map((l) => l.file.replace(/-[\w-]+\.js$/, '')) },
}));
