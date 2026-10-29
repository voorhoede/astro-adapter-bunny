// usage: [POPS=US:NY,DE:DE+BE,SG:SG] node summarize.mjs <results.jsonl>...; prints cold and warm medians and ranges per file and probe country
// POPS drops probes served by a PoP outside the listed ones for their country. Cold: the isolate's first request (count 1). Startup gap: time to first byte minus the handler's run time.
import { readFileSync } from 'node:fs';
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const cell = (a) => a.length ? `${Math.round(median(a))} (${Math.round(Math.min(...a))} to ${Math.round(Math.max(...a))})` : '';
for (const file of process.argv.slice(2)) {
  const pops = Object.fromEntries((process.env.POPS ?? '').split(',').filter(Boolean).map((e) => e.split(':')).map(([c, p]) => [c, p.split('+')]));
  const rows = readFileSync(file, 'utf8').trim().split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l))
    .filter((r) => !pops[r.country] || pops[r.country].includes(r.pop));
  for (const country of [...new Set(rows.map((r) => r.country))]) {
    const own = rows.filter((r) => r.country === country);
    for (const [kind, set] of [['cold', own.filter((r) => r.count === 1)], ['warm', own.filter((r) => r.count > 1)]]) {
      if (!set.length) continue;
      const unpack = set.map((r) => (r.parts ?? []).reduce((s, p) => s + (p.unpackMs ?? 0), 0));
      console.log([file.split('/').pop(), country, kind, `n=${set.length}`, `pops=${[...new Set(set.map((r) => r.pop))].join('/')}`,
        `ttfb ${cell(set.map((r) => r.ttfb))}`, `handler ${cell(set.map((r) => r.runMs ?? 0))}`, `gap ${cell(set.map((r) => r.ttfb - (r.runMs ?? 0)))}`,
        `unpack ${cell(unpack)}`, `errors ${set.filter((r) => r.status !== 200).length}`].join(' | '));
    }
  }
}
