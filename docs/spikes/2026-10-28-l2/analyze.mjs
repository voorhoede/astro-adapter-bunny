import { rollup } from 'rollup';
import { builtinModules } from 'node:module';
import { rm } from 'node:fs/promises';

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const routes = { '/': 'index_', '/env': 'env_', '/code': 'code_' };

async function run(label, output) {
  const externals = new Set();
  const warnings = [];
  const bundle = await rollup({
    input: 'app/dist/server/entry.mjs',
    external: (id) => (builtins.has(id) ? (externals.add(id), true) : false),
    onwarn: (warning) => warnings.push(warning.code),
  });
  const dir = `out-${label}`;
  await rm(dir, { recursive: true, force: true });
  const { output: chunks } = await bundle.write({ dir, format: 'system', ...output });
  const byName = new Map(chunks.filter((c) => c.type === 'chunk').map((c) => [c.fileName, c]));
  const size = (names) => [...names].reduce((sum, n) => sum + Buffer.byteLength(byName.get(n).code), 0);
  const closure = (start, seen = new Set()) => {
    if (seen.has(start)) return seen;
    seen.add(start);
    for (const dep of byName.get(start).imports) closure(dep, seen);
    return seen;
  };
  const entry = [...byName.values()].find((c) => c.isEntry).fileName;
  const eager = closure(entry);
  const report = { label, files: byName.size, totalKB: Math.round(size(byName.keys()) / 1024), eagerFiles: eager.size, eagerKB: Math.round(size(eager) / 1024), routes: {} };
  for (const [route, prefix] of Object.entries(routes)) {
    const page = [...byName.values()].find((c) => c.facadeModuleId?.includes(`/chunks/${prefix}`));
    const lazy = new Set([...closure(page.fileName)].filter((n) => !eager.has(n)));
    report.routes[route] = { lazyFiles: lazy.size, lazyKB: Math.round(size(lazy) / 1024) };
  }
  const largest = [...byName.values()].sort((a, b) => b.code.length - a.code.length)[0];
  report.largestKB = Math.round(Buffer.byteLength(largest.code) / 1024);
  report.largest = largest.fileName;
  report.externals = [...externals].sort();
  report.warnings = [...new Set(warnings)];
  console.log(JSON.stringify(report, null, 1));
}

await run('default', {});
await run('min32k', { experimentalMinChunkSize: 32 * 1024 });
