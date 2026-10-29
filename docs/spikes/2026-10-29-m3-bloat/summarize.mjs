// usage: [POPS=US:NY,DE:DE+BE,SG:SG] node summarize.mjs <results.jsonl>...
// Prints per cell and probe country: answered probes, cold 200 samples, median / p90 time to first byte of cold
// requests, median / p90 of x-spike-loaded (performance.now() when the middleware module was evaluated) and the
// non-200 statuses. POPS drops probes served by a PoP outside the listed ones for their country. Cold: the
// isolate's first request (x-spike-count 1).
import { readFileSync } from 'node:fs';

const quantile = (a, q) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const at = (s.length - 1) * q;
  return s[Math.floor(at)] + (s[Math.ceil(at)] - s[Math.floor(at)]) * (at - Math.floor(at));
};
const cell = (a) => (a.length ? `${Math.round(quantile(a, 0.5))} / ${Math.round(quantile(a, 0.9))}` : '');

const pops = Object.fromEntries((process.env.POPS ?? '').split(',').filter(Boolean).map((e) => e.split(':')).map(([c, p]) => [c, p.split('+')]));
const rows = process.argv.slice(2).flatMap((file) => readFileSync(file, 'utf8').trim().split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)));
const finished = rows.filter((r) => r.probeStatus === 'finished');
const kept = finished.filter((r) => !pops[r.country] || !r.pop || pops[r.country].includes(r.pop));
console.log(`rows ${rows.length}, finished ${finished.length}, kept ${kept.length} (dropped ${finished.length - kept.length} for a PoP outside the region)`);
console.log(['cell', 'country', 'answered', 'cold 200', 'warm 200', 'cold ttfb', 'loaded', 'non-200'].join(' | '));
for (const name of [...new Set(kept.map((r) => r.cell))]) {
  for (const country of ['US', 'DE', 'SG']) {
    const set = kept.filter((r) => r.cell === name && r.country === country);
    if (!set.length) continue;
    const cold = set.filter((r) => r.status === 200 && r.count === 1);
    const other = {};
    for (const r of set.filter((r) => r.status !== 200)) other[r.status] = (other[r.status] ?? 0) + 1;
    console.log([name, country, set.length, cold.length, set.filter((r) => r.status === 200 && r.count > 1).length,
      cell(cold.map((r) => r.ttfb)), cell(cold.map((r) => r.loadedMs)), JSON.stringify(other)].join(' | '));
  }
}
