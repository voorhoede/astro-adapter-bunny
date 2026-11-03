import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import { runScript } from '../../test/harness/run-script.ts';
import { bundle, type BuildLogger } from './bundle.ts';

const silent: BuildLogger = { warn: () => {}, info: () => {}, debug: () => {} };

async function serverOutput(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'bundle-'));
  await Promise.all(Object.entries(files).map(([name, code]) => writeFile(join(dir, name), code)));
  return dir;
}

async function scriptOf(files: Record<string, string>) {
  const dir = await serverOutput(files);
  const output = await bundle({ dir, entry: 'entry.mjs', logger: silent });
  const script = join(dir, 'index.js');
  await writeFile(script, output.code);
  return { ...output, script };
}

// The entry registers its handler as Astro's server entry does; pages load through import() and have a side effect, as Astro's do.
const site = {
  'entry.mjs': [
    "const pages = { '/a': () => import('./page-a.mjs'), '/b': () => import('./page-b.mjs') };",
    'Bunny.v1.serve(async (request) => {',
    '  const page = pages[new URL(request.url).pathname];',
    "  if (!page) return new Response('missing', { status: 404 });",
    '  return new Response(String((await page()).default));',
    '});',
  ].join('\n'),
  'page-a.mjs':
    "import { shared } from './shared.mjs'; globalThis.rendered = 'a'; export default `page-a ${shared}`;",
  'page-b.mjs':
    "import { shared } from './shared.mjs'; globalThis.rendered = 'b'; export default `page-b ${shared}`;",
  'shared.mjs': "export const shared = 'shared';",
};

test('the script loads on its own and registers a handler', async () => {
  const { script } = await scriptOf(site);
  const run = await runScript(script);
  assert.equal(run.error, undefined);
  assert.equal(run.loaded, true);
});

test('every page renders from the one script, which imports nothing at runtime', async () => {
  const { code, script } = await scriptOf(site);
  assert.doesNotMatch(code, /\bimport\s*\(/);
  const [a, b] = (await runScript(script, ['/a', '/b'])).responses;
  assert.equal(a?.body, 'page-a shared');
  assert.equal(b?.body, 'page-b shared');
});

test('a Node builtin the server imports works from the script, and is listed', async () => {
  const { script, builtins } = await scriptOf({
    'entry.mjs':
      "import { join } from 'node:path'; Bunny.v1.serve(() => new Response(join('a', 'b')));",
  });
  assert.deepEqual(builtins, ['node:path']);
  const [response] = (await runScript(script, ['/'])).responses;
  assert.equal(response?.body, 'a/b');
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
    await assert.rejects(bundle({ dir, entry: 'entry.mjs', logger: silent }), new RegExp(builtin));
  });
}

test('a package import that Astro left unbundled fails the build, naming it', async () => {
  const dir = await serverOutput({
    'entry.mjs': "import pad from 'left-pad'; export default pad;",
  });
  await assert.rejects(bundle({ dir, entry: 'entry.mjs', logger: silent }), /left-pad/);
});

test('bundler warnings reach the build logger instead of the console', async () => {
  const dir = await serverOutput({
    'entry.mjs': "Bunny.v1.serve(() => new Response(String(eval('1 + 2'))));",
  });
  const warnings: string[] = [];
  const printed = mock.method(console, 'warn', () => {});
  await bundle({
    dir,
    entry: 'entry.mjs',
    logger: { ...silent, warn: (message) => warnings.push(message) },
  });
  printed.mock.restore();
  assert.equal(printed.mock.callCount(), 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /eval/);
});

test('the site data is in the script as a global before any server code runs', async () => {
  const dir = await serverOutput({
    'entry.mjs':
      'const base = globalThis.__BUNNY_SITE__.base; Bunny.v1.serve(() => new Response(base));',
  });
  const { code } = await bundle({
    dir,
    entry: 'entry.mjs',
    logger: silent,
    siteData: { base: '/docs/' },
  });
  const script = join(dir, 'index.js');
  await writeFile(script, code);
  const [response] = (await runScript(script, ['/'])).responses;
  assert.equal(response?.body, '/docs/');
});
