// usage: [POPS=US:NY,DE:DE+BE,SG:SG] node summarize.mjs <results.jsonl>...
// Prints per cell and probe country: cold and warm sample counts, median / p90 of time to first byte, the startup gap
// (time to first byte minus the handler's run time), the eager import, unpacking and render, and the body hashes.
// POPS drops probes served by a PoP outside the listed ones for their country. Cold: the isolate's first request.
import { readFileSync } from 'node:fs';
const quantile = (a, q) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const at = (s.length - 1) * q;
  return s[Math.floor(at)] + (s[Math.ceil(at)] - s[Math.floor(at)]) * (at - Math.floor(at));
};
const cell = (a) => `${Math.round(quantile(a, 0.5))} / ${Math.round(quantile(a, 0.9))}`;
const pops = Object.fromEntries((process.env.POPS ?? '').split(',').filter(Boolean).map((e) => e.split(':')).map(([c, p]) => [c, p.split('+')]));
const rows = process.argv.slice(2).flatMap((file) => readFileSync(file, 'utf8').trim().split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)));
const kept = rows.filter((r) => r.probeStatus === 'finished' && (!pops[r.country] || pops[r.country].includes(r.pop)));
console.log(`rows ${rows.length}, kept ${kept.length}, dropped ${rows.length - kept.length} (PoP outside region or probe failure)`);
const header = ['cell', 'country', 'kind', 'n', 'pops', 'ttfb', 'gap', 'eager', 'unpack', 'render', 'run', 'errors', 'sha'];
console.log(header.join(' | '));
for (const name of [...new Set(kept.map((r) => r.cell))]) {
  for (const country of ['US', 'DE', 'SG']) {
    const own = kept.filter((r) => r.cell === name && r.country === country);
    for (const [kind, set] of [['cold', own.filter((r) => r.count === 1)], ['warm', own.filter((r) => r.count > 1)]]) {
      if (!set.length) continue;
      const ok = set.filter((r) => r.status === 200);
      console.log([name, country, kind, set.length, [...new Set(set.map((r) => r.pop))].join('/'),
        cell(ok.map((r) => r.ttfb)), cell(ok.map((r) => r.ttfb - r.runMs)), cell(ok.map((r) => r.eagerMs)),
        cell(ok.map((r) => r.unpackMs)), cell(ok.map((r) => r.renderMs)), cell(ok.map((r) => r.runMs)),
        set.length - ok.length, [...new Set(ok.map((r) => r.sha))].join('/')].join(' | '));
    }
  }
}
