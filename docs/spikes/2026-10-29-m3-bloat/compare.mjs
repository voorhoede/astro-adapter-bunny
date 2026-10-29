// usage: node compare.mjs <local.mjs output> <node-ref.mjs output>; prints mismatches and a summary.
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8').trim().split('\n').at(-1)));
const ref = new Map(b.results.map((r) => [r.path, r]));
const bad = a.results.filter((r) => ref.get(r.path)?.sha !== r.sha || ref.get(r.path)?.status !== r.status);
for (const r of bad.slice(0, 10)) console.log('mismatch', r.path, r.status, ref.get(r.path)?.status);
const statuses = {};
for (const r of a.results) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
console.log(JSON.stringify({ routes: a.results.length, same: a.results.length - bad.length, statuses, loadMs: a.loadMs, memory: a.memory }));
