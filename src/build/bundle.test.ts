import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import { runScript } from '../../test/harness/run-script.ts';
import { bundle, checkScriptSize, type BuildLogger } from './bundle.ts';

const silent: BuildLogger = { warn: () => {}, info: () => {}, debug: () => {} };

const filler = (kilobytes: number) =>
  `export const data = ${JSON.stringify('x'.repeat(kilobytes * 1024))};`;

const WASM_HEADER = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]).toString('base64');

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

// Each page has a side effect, as Astro pages do when they register their component.
const site = {
  'entry.mjs': [
    "import { eager } from './eager.mjs';",
    'export class NamedThing {}',
    'function notFound(path) {',
    '  const unusuallyLongLocalVariableName = `missing ${path}`;',
    '  return new Response(unusuallyLongLocalVariableName, { status: 404 });',
    '}',
    'const pages = {',
    "  '/a': () => import('./page-a.mjs'),",
    "  '/b': () => import('./page-b.mjs'),",
    "  '/wasm': () => import('./wasm.mjs'),",
    '};',
    'export default {',
    '  async fetch(request) {',
    '    const { pathname } = new URL(request.url);',
    "    if (pathname === '/eager') return new Response(eager);",
    "    if (pathname === '/name') return new Response(NamedThing.name);",
    '    const page = pages[pathname];',
    '    return page ? new Response(String((await page()).default)) : notFound(pathname);',
    '  },',
    '};',
  ].join('\n'),
  'eager.mjs': "export const eager = 'eager-marker';",
  'page-a.mjs':
    "import { data } from './big.mjs'; import { tiny } from './tiny.mjs'; globalThis.rendered = 'a'; export default `page-a-marker ${data.length} ${tiny}`;",
  'page-b.mjs':
    "import { tiny } from './tiny.mjs'; globalThis.rendered = 'b'; export default `page-b-marker ${tiny}`;",
  'big.mjs': filler(40),
  'tiny.mjs': 'export const tiny = 2;',
  'wasm.mjs': `var wasmBinary = Uint8Array.from(atob("${WASM_HEADER}"), (c) => c.charCodeAt(0));\nexport default Array.from(wasmBinary).join(',');`,
};

test('the script loads on its own, registers a handler and unpacks nothing', async () => {
  const { script } = await scriptOf(site);
  const run = await runScript(script);
  assert.equal(run.error, undefined);
  assert.equal(run.loaded, true);
  assert.equal(run.unpackedOnLoad, 0);
});

test('eager code needs no unpacking', async () => {
  const { script } = await scriptOf(site);
  const [eager] = (await runScript(script, ['/eager'])).responses;
  assert.deepEqual(eager, { status: 200, body: 'eager-marker', unpacked: 0 });
});

test('a route unpacks only the lazy chunks it needs, once per isolate', async () => {
  const { script } = await scriptOf(site);
  const [a, b, again] = (await runScript(script, ['/a', '/b', '/a'])).responses;
  assert.deepEqual(a, { status: 200, body: `page-a-marker ${40 * 1024} 2`, unpacked: 2 });
  assert.deepEqual(b, { status: 200, body: 'page-b-marker 2', unpacked: 1 });
  assert.deepEqual(again, { status: 200, body: `page-a-marker ${40 * 1024} 2`, unpacked: 0 });
});

test('lazy code is in the script only as packed data', async () => {
  const { code } = await scriptOf(site);
  assert.match(code, /eager-marker/);
  assert.doesNotMatch(code, /page-b-marker/);
  assert.doesNotMatch(code, /x{1000}/);
});

test('the script is minified and keeps function and class names', async () => {
  const { code, script } = await scriptOf(site);
  assert.doesNotMatch(code, /unusuallyLongLocalVariableName/);
  const [name] = (await runScript(script, ['/name'])).responses;
  assert.equal(name?.body, 'NamedThing');
});

test("Shiki's inlined wasm is packed as bytes and decodes to the same bytes", async () => {
  const { script, wasm } = await scriptOf(site);
  assert.equal(wasm, true);
  const [response] = (await runScript(script, ['/wasm'])).responses;
  assert.equal(response?.body, '0,97,115,109,1,0,0,0');
});

test("a build without Shiki's wasm pattern still renders, and reports the rewrite as skipped", async () => {
  const { script, wasm } = await scriptOf({
    ...site,
    'wasm.mjs': `const text = atob("${WASM_HEADER}");\nexport default Array.from(text, (c) => c.charCodeAt(0)).join(',');`,
  });
  assert.equal(wasm, false);
  const [response] = (await runScript(script, ['/wasm'])).responses;
  assert.equal(response?.body, '0,97,115,109,1,0,0,0');
});

test("the server manifest's entryModules keep no entry that points at a server file", async () => {
  const { script } = await scriptOf({
    ...site,
    'entry.mjs': [
      'function deserializeManifest(manifest) { return manifest; }',
      'var _manifest = deserializeManifest({"entryModules":{',
      '"\\u0000noop-middleware":"middleware.mjs",',
      '"/build/host/src/pages/a.astro":"page-a.mjs",',
      '"astro:scripts/page.js":"_astro/page.Ab12.js"',
      '}});',
      'export default { fetch: () => new Response(JSON.stringify(_manifest.entryModules)) };',
    ].join('\n'),
    'middleware.mjs': 'export const onRequest = (context, next) => next();',
  });
  const [response] = (await runScript(script, ['/'])).responses;
  assert.deepEqual(JSON.parse(response?.body ?? ''), {
    'astro:scripts/page.js': '_astro/page.Ab12.js',
  });
});

test('a source map comes with the script, and the script does not point at it', async () => {
  const { code, map } = await scriptOf(site);
  const parsed = JSON.parse(map);
  assert.equal(parsed.version, 3);
  assert.ok(JSON.stringify(parsed).includes('entry.mjs'));
  assert.doesNotMatch(code, /sourceMappingURL/);
});

test('a Node builtin the server imports works from the script, and is listed', async () => {
  const { script, builtins } = await scriptOf({
    'entry.mjs':
      "import { join } from 'node:path'; export default { fetch: () => new Response(join('a', 'b')) };",
  });
  assert.deepEqual(builtins, ['node:path']);
  const [response] = (await runScript(script, ['/'])).responses;
  assert.equal(response?.body, 'a/b');
});

// The shape Rolldown gives a CommonJS dependency, such as postcss, that requires a builtin.
const commonJs = (id: string) => ({
  'entry.mjs':
    "export default { fetch: async () => new Response(String((await import('./page.mjs')).default)) };",
  'runtime.mjs': [
    "import { createRequire } from 'node:module';",
    'var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();',
    'export { __require };',
  ].join('\n'),
  'page.mjs': `import { __require } from './runtime.mjs';\nvar { join } = __require("${id}");\nexport default typeof join === 'function' ? join('a', 'b') : 'none';`,
});

test('a CommonJS require of a Node builtin works from the script', async () => {
  const { script, builtins } = await scriptOf(commonJs('path'));
  assert.ok(builtins.includes('node:path'));
  const [response] = (await runScript(script, ['/'])).responses;
  assert.deepEqual(response, { status: 200, body: 'a/b', unpacked: 1 });
});

test('a CommonJS require of a package that Astro left unbundled fails the build, naming it', async () => {
  const dir = await serverOutput(commonJs('left-pad'));
  await assert.rejects(bundle({ dir, entry: 'entry.mjs', logger: silent }), /left-pad/);
});

test('a CommonJS require of a builtin bunny.net does not run fails the build, naming it', async () => {
  const dir = await serverOutput(commonJs('child_process'));
  await assert.rejects(bundle({ dir, entry: 'entry.mjs', logger: silent }), /child_process/);
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

test('Rollup warnings reach the build logger instead of the console', async () => {
  const dir = await serverOutput({
    'entry.mjs': 'export default { fetch: () => new Response(String(/*#__PURE__*/ 1 + 2)) };',
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
  assert.match(warnings[0] ?? '', /annotation/);
});

test('a script up to 4 MB passes, above it warns, and above 7 MB fails', () => {
  assert.equal(checkScriptSize(3.5 * 1024 * 1024), 'ok');
  assert.equal(checkScriptSize(4.5 * 1024 * 1024), 'warn');
  assert.throws(() => checkScriptSize(7.5 * 1024 * 1024), /7 MB/);
});
