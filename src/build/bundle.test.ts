import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { bundle, checkEagerSize } from './bundle.ts';

const filler = (kilobytes: number) =>
  `export const data = ${JSON.stringify('x'.repeat(kilobytes * 1024))};`;

async function serverOutput(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'bundle-'));
  await Promise.all(Object.entries(files).map(([name, code]) => writeFile(join(dir, name), code)));
  return dir;
}

// The entry stands in for Astro's runtime, which is always far above the merge threshold.
// Pages have side effects, as Astro pages do when they register their component.
const site = {
  'entry.mjs': [
    "import { shared } from './shared.mjs';",
    `export const runtime = ${JSON.stringify('e'.repeat(64 * 1024))};`,
    "export const pages = { a: () => import('./page-a.mjs'), b: () => import('./page-b.mjs') };",
    'export default shared;',
  ].join('\n'),
  'shared.mjs': "export const shared = 'shared-marker';",
  'page-a.mjs':
    "import { data } from './big.mjs'; import { tiny } from './tiny.mjs'; globalThis.rendered = 'a'; export default data + tiny;",
  'page-b.mjs':
    "import { tiny } from './tiny.mjs'; globalThis.rendered = 'b'; export default tiny;",
  'big.mjs': filler(40),
  'tiny.mjs': 'export const tiny = 2;',
};

test('every chunk is System.register code', async () => {
  const output = await bundle({ dir: await serverOutput(site), entry: 'entry.mjs' });
  for (const chunk of output.chunks) assert.match(chunk.code, /^System\.register\(/);
});

test('the eager part is the entry and what it imports statically', async () => {
  const output = await bundle({ dir: await serverOutput(site), entry: 'entry.mjs' });
  const eagerCode = output.chunks
    .filter((chunk) => output.eager.includes(chunk.fileName))
    .map((chunk) => chunk.code)
    .join('\n');
  assert.ok(output.eager.includes(output.entry));
  assert.match(eagerCode, /shared-marker/);
  assert.doesNotMatch(eagerCode, /x{1000}/);
});

test('merging never moves a lazy page into the eager part, even when the entry is small', async () => {
  const output = await bundle({
    dir: await serverOutput({
      ...site,
      'entry.mjs':
        "export const pages = { a: () => import('./page-a.mjs'), b: () => import('./page-b.mjs') };",
    }),
    entry: 'entry.mjs',
  });
  const eagerCode = output.chunks
    .filter((chunk) => output.eager.includes(chunk.fileName))
    .map((chunk) => chunk.code)
    .join('\n');
  assert.doesNotMatch(eagerCode, /x{1000}/);
  assert.equal(Object.keys(output.targets).length, 2);
});

test('each import() target lists the parts it needs, without the eager ones', async () => {
  const output = await bundle({ dir: await serverOutput(site), entry: 'entry.mjs' });
  const targets = Object.values(output.targets);
  assert.equal(targets.length, 2);
  for (const files of targets) {
    for (const file of files) assert.equal(output.eager.includes(file), false);
  }
});

test('a chunk smaller than 32 kB that two targets share is merged, so neither needs an extra fetch', async () => {
  const output = await bundle({ dir: await serverOutput(site), entry: 'entry.mjs' });
  for (const files of Object.values(output.targets)) {
    const sizes = files.map(
      (file) => output.chunks.find((chunk) => chunk.fileName === file)!.bytes,
    );
    assert.equal(sizes.filter((bytes) => bytes < 32 * 1024).length <= 1, true);
  }
});

test('every chunk carries the SHA-256 of its code', async () => {
  const output = await bundle({ dir: await serverOutput(site), entry: 'entry.mjs' });
  for (const chunk of output.chunks) {
    assert.equal(chunk.sha256, createHash('sha256').update(chunk.code).digest('hex'));
    assert.equal(chunk.bytes, Buffer.byteLength(chunk.code));
  }
});

test('a target that needs more than 8 parts fails the build, naming the target and the count', async () => {
  const libs = Array.from({ length: 8 }, (_, index) => `lib-${index}.mjs`);
  const files: Record<string, string> = {
    'entry.mjs': [
      "export const heavy = () => import('./heavy.mjs');",
      ...libs.map((lib, index) => `export const lib${index} = () => import('./${lib}');`),
    ].join('\n'),
    'heavy.mjs': libs
      .map((lib, index) => `export { data as d${index} } from './${lib}';`)
      .join('\n'),
  };
  for (const lib of libs) files[lib] = filler(40);
  await assert.rejects(
    bundle({ dir: await serverOutput(files), entry: 'entry.mjs' }),
    /heavy.*9 parts.*8/s,
  );
});

test('a target nested behind another lazy part may need more than 8 parts, since only a route starts there', async () => {
  const libs = Array.from({ length: 9 }, (_, index) => `lib-${index}.mjs`);
  const files: Record<string, string> = {
    'entry.mjs': [
      `export const runtime = ${JSON.stringify('e'.repeat(64 * 1024))};`,
      "export const page = () => import('./page.mjs');",
      ...libs.map((lib, index) => `export const lib${index} = () => import('./${lib}');`),
    ].join('\n'),
    'page.mjs':
      "globalThis.rendered = 'page'; export const grammar = () => import('./grammar.mjs');",
    'grammar.mjs': libs
      .map((lib, index) => `export { data as d${index} } from './${lib}';`)
      .join('\n'),
  };
  for (const lib of libs) files[lib] = filler(40);
  const output = await bundle({ dir: await serverOutput(files), entry: 'entry.mjs' });
  const grammar = Object.entries(output.targets).find(([name]) => name.startsWith('grammar'));
  assert.ok(grammar);
  assert.equal(grammar[1].length, 10);
});

test('Node builtins stay outside the bundle and are listed', async () => {
  const output = await bundle({
    dir: await serverOutput({
      'entry.mjs': "import { join } from 'node:path'; export default join('a', 'b');",
    }),
    entry: 'entry.mjs',
  });
  assert.deepEqual(output.builtins, ['node:path']);
});

for (const builtin of [
  'node:child_process',
  'node:vm',
  'node:worker_threads',
  'node:constants',
  'node:path/win32',
]) {
  test(`${builtin}, which bunny.net does not run, fails the build`, async () => {
    const dir = await serverOutput({ 'entry.mjs': `import '${builtin}'; export default 1;` });
    await assert.rejects(bundle({ dir, entry: 'entry.mjs' }), new RegExp(builtin));
  });
}

test('a package import that Astro left unbundled fails the build, naming it', async () => {
  const dir = await serverOutput({
    'entry.mjs': "import pad from 'left-pad'; export default pad;",
  });
  await assert.rejects(bundle({ dir, entry: 'entry.mjs' }), /left-pad/);
});

test('an eager script up to 1 MB passes, above it warns, and above 7 MB fails', () => {
  assert.equal(checkEagerSize(900 * 1024), 'ok');
  assert.equal(checkEagerSize(2 * 1024 * 1024), 'warn');
  assert.throws(() => checkEagerSize(7.5 * 1024 * 1024), /7 MB/);
});
