// usage: [POPS=US:NY,DE:DE+BE,SG:SG] [BASE=v5] node summarize.mjs <results.jsonl>...
// Prints per cell and probe country the cold sample count, median / p90 of time to first byte, the startup gap (time to
// first byte minus the handler's run time), the eager import, unpacking, render and run, and the body hashes. Then, per
// route and country, compares BASE with every other variant on cold time to first byte, gap and run: the difference of
// medians, a 95% bootstrap interval of that difference (10,000 resamples, fixed seed) and a two-sided Mann-Whitney U
// p value (normal approximation with tie correction), per country and pooled over countries. POPS drops probes served
// by a PoP outside the listed ones for their country. Cold: the isolate's first request.
import { readFileSync } from 'node:fs';

const quantile = (a, q) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const at = (s.length - 1) * q;
  return s[Math.floor(at)] + (s[Math.ceil(at)] - s[Math.floor(at)]) * (at - Math.floor(at));
};
const median = (a) => quantile(a, 0.5);
const cell = (a) => `${Math.round(median(a))} / ${Math.round(quantile(a, 0.9))}`;

let seed = 42;
const random = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const resample = (a) => a.map(() => a[Math.floor(random() * a.length)]);
const bootstrap = (a, b) => {
  const d = Array.from({ length: 10000 }, () => median(resample(b)) - median(resample(a)));
  return [quantile(d, 0.025), quantile(d, 0.975)];
};

const erfc = (x) => {
  const t = 1 / (1 + 0.5 * Math.abs(x));
  const y = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806
    + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? y : 2 - y;
};
const mannWhitney = (a, b) => {
  const all = [...a.map((v) => [v, 0]), ...b.map((v) => [v, 1])].sort((x, y) => x[0] - y[0]);
  const ranks = new Array(all.length);
  let ties = 0;
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++;
    for (let k = i; k <= j; k++) ranks[k] = (i + j) / 2 + 1;
    ties += (j - i + 1) ** 3 - (j - i + 1);
    i = j + 1;
  }
  const n1 = a.length, n2 = b.length, n = n1 + n2;
  const r1 = all.reduce((s, [, g], i) => s + (g === 0 ? ranks[i] : 0), 0);
  const u = r1 - (n1 * (n1 + 1)) / 2;
  const sigma = Math.sqrt((n1 * n2 / 12) * (n + 1 - ties / (n * (n - 1))));
  const z = Math.max(0, Math.abs(u - (n1 * n2) / 2) - 0.5) / sigma;
  return erfc(z / Math.SQRT2);
};

const pops = Object.fromEntries((process.env.POPS ?? '').split(',').filter(Boolean).map((e) => e.split(':')).map(([c, p]) => [c, p.split('+')]));
const rows = process.argv.slice(2).flatMap((file) => readFileSync(file, 'utf8').trim().split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)));
const kept = rows.filter((r) => r.probeStatus === 'finished' && (!pops[r.country] || pops[r.country].includes(r.pop)));
const cold = kept.filter((r) => r.count === 1 && r.status === 200);
console.log(`rows ${rows.length}, kept ${kept.length}, cold 200 ${cold.length}, warm ${kept.filter((r) => r.count > 1).length}, `
  + `non-200 ${kept.filter((r) => r.status !== 200).length}, dropped ${rows.length - kept.length} (PoP outside region or probe failure)`);
console.log(`hashes: ${[...new Set(kept.map((r) => `${r.cell} ${r.status} ${r.sha}`))].sort().join(', ')}`);

const metrics = { ttfb: (r) => r.ttfb, gap: (r) => r.ttfb - r.runMs, run: (r) => r.runMs };
const of = (name, country) => cold.filter((r) => r.cell === name && r.country === country);
const countries = ['US', 'DE', 'SG'];

console.log(['cell', 'country', 'n', 'ttfb', 'gap', 'eager', 'unpack', 'render', 'run'].join(' | '));
for (const name of [...new Set(cold.map((r) => r.cell))]) {
  for (const country of countries) {
    const set = of(name, country);
    if (!set.length) continue;
    console.log([name, country, set.length, cell(set.map(metrics.ttfb)), cell(set.map(metrics.gap)), cell(set.map((r) => r.eagerMs)),
      cell(set.map((r) => r.unpackMs)), cell(set.map((r) => r.renderMs)), cell(set.map(metrics.run))].join(' | '));
  }
}

const base = process.env.BASE ?? 'v5';
const round = (n) => Math.round(n);
console.log(`\ndifference of medians, other minus ${base}, ms [95% bootstrap interval] (Mann-Whitney p)`);
console.log(['route', 'variant', 'country', 'n', ...Object.keys(metrics)].join(' | '));
for (const route of [...new Set(cold.map((r) => r.cell.split(':')[1]))]) {
  for (const variant of [...new Set(cold.map((r) => r.cell.split(':')[0]))].filter((v) => v !== base)) {
    for (const country of countries) {
      const a = of(`${base}:${route}`, country), b = of(`${variant}:${route}`, country);
      if (!a.length || !b.length) continue;
      const parts = Object.values(metrics).map((f) => {
        const x = a.map(f), y = b.map(f);
        const [lo, hi] = bootstrap(x, y);
        return `${round(median(y) - median(x))} [${round(lo)}, ${round(hi)}] (p ${mannWhitney(x, y).toFixed(3)})`;
      });
      console.log([route, variant, country, `${a.length}/${b.length}`, ...parts].join(' | '));
    }
  }
}

console.log(`\npooled over countries, each sample minus its route and country median over all variants, other minus ${base}`);
console.log(['route', 'variant', 'n', 'ttfb', 'gap'].join(' | '));
for (const route of [...new Set(cold.map((r) => r.cell.split(':')[1]))]) {
  for (const variant of [...new Set(cold.map((r) => r.cell.split(':')[0]))].filter((v) => v !== base)) {
    const parts = ['ttfb', 'gap'].map((metric) => {
      const f = metrics[metric], a = [], b = [];
      for (const country of countries) {
        const own = cold.filter((r) => r.country === country && r.cell.endsWith(`:${route}`));
        const center = median(own.map(f));
        for (const r of own) {
          if (r.cell === `${base}:${route}`) a.push(f(r) - center);
          if (r.cell === `${variant}:${route}`) b.push(f(r) - center);
        }
      }
      const [lo, hi] = bootstrap(a, b);
      return [`${a.length}/${b.length}`, `${round(median(b) - median(a))} [${round(lo)}, ${round(hi)}] (p ${mannWhitney(a, b).toFixed(4)})`];
    });
    console.log([route, variant, parts[0][0], parts[0][1], parts[1][1]].join(' | '));
  }
}
