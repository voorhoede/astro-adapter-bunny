import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'astro';
import { bundle } from '../../src/build/bundle.ts';
import { runScript } from '../harness/run-script.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const SECRET = 'build-time-secret-value-7c1f';

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

async function contents(paths: string[]): Promise<Array<[string, string]>> {
  return Promise.all(
    paths.map(async (path) => [path, await readFile(path, 'utf8')] as [string, string]),
  );
}

async function manifest(project: string) {
  return JSON.parse(await readFile(join(project, '.bunny/build.json'), 'utf8'));
}

for (const script of ['middleware', 'standalone'] as const) {
  describe(`the test app as a ${script} script`, () => {
    before(async () => {
      process.env.TEST_SCRIPT = script;
      process.env.CMS_TOKEN = SECRET;
      await build({ root, logLevel: 'error' });
    });

    test('the build writes the script and the manifest names its type', async () => {
      assert.ok(existsSync(join(root, 'dist/index.js')));
      const written = await manifest(root);
      assert.equal(written.kind, 'ssr');
      assert.deepEqual(written.script.type, script);
      assert.equal(written.script.entry, 'dist/index.js');
    });

    test('the client directory holds no server code', async () => {
      assert.equal(existsSync(join(root, 'dist/client/_bunny')), false);
      for (const [file, code] of await contents(await files(join(root, 'dist/client'))))
        assert.doesNotMatch(code, /System\.register\(/, file);
    });

    test('the source map lies next to the script, outside the client directory', () => {
      assert.ok(existsSync(join(root, 'dist/index.js.map')));
    });

    test('the manifest gives the size of the script and reserves no path', async () => {
      const written = await manifest(root);
      assert.equal(written.script.bytes, (await stat(join(root, 'dist/index.js'))).size);
      assert.equal(written.assets.reserved, undefined);
    });

    test('the script, copied alone, loads without the deploy global and unpacks nothing', async () => {
      const alone = join(await mkdtemp(join(tmpdir(), 'script-')), 'index.js');
      await copyFile(join(root, 'dist/index.js'), alone);
      const run = await runScript(alone);
      assert.equal(run.error, undefined);
      assert.equal(run.loaded, true);
      assert.equal(run.unpackedOnLoad, 0);
    });

    for (const path of ['/code', '/css']) {
      test(`${path} renders from the script with the same HTML as the server build`, async () => {
        const server = await import(`${join(root, 'dist/server/entry.mjs')}?${path}-${script}`);
        const expected = await server.default.fetch(new Request(`https://example.com${path}`));
        const [response] = (await runScript(join(root, 'dist/index.js'), [path])).responses;
        assert.equal(response?.status, 200);
        assert.equal(response?.body, await expected.text());
      });
    }

    test("Shiki's wasm in the test app is packed as bytes", async () => {
      const { wasm } = await bundle({
        dir: join(root, 'dist/server'),
        entry: 'entry.mjs',
        logger: { warn: () => {}, info: () => {}, debug: () => {} },
      });
      assert.equal(wasm, true);
    });

    test('requires.env lists the storage variables and the server secret, not the public variable', async () => {
      const names = (await manifest(root)).requires.env.map(
        (entry: { name: string }) => entry.name,
      );
      assert.deepEqual(names, [
        'BUNNY_STORAGE_ZONE',
        'BUNNY_STORAGE_HOST',
        'BUNNY_STORAGE_KEY',
        'CMS_TOKEN',
      ]);
    });

    test('no secret value from the build environment ends up in the output', async () => {
      const written = [...(await files(join(root, 'dist'))), join(root, '.bunny/build.json')];
      for (const [file, code] of await contents(written))
        assert.equal(code.includes(SECRET), false, file);
    });

    test('Sharp optimizes images at build and is absent from the server output', async () => {
      const client = await files(join(root, 'dist/client/_astro'));
      assert.ok(client.some((file) => file.endsWith('.webp')));
      for (const [, code] of await contents(await files(join(root, 'dist/server')))) {
        assert.doesNotMatch(code, /detect-libc|sharp-libvips/);
      }
    });

    test('a rendered page keeps every cookie it sets', async () => {
      const server = await import(`${join(root, 'dist/server/entry.mjs')}?${script}`);
      const response = await server.default.fetch(new Request('https://example.com/cookies'));
      const cookies = response.headers.getSetCookie();
      assert.equal(response.status, 200);
      assert.equal(cookies.length, 2);
      assert.match(cookies[1]!, /Partitioned/);
    });

    test('Astro renders no meta refresh page for a redirect', () => {
      assert.equal(existsSync(join(root, 'dist/client/old/index.html')), false);
    });
  });
}

describe('a site with every route prerendered', () => {
  const project = fileURLToPath(new URL('../fixtures/static-only/', import.meta.url));
  before(() => build({ root: project, logLevel: 'error' }));

  test('gets no script, and the manifest says static', async () => {
    assert.equal(existsSync(join(project, 'dist/index.js')), false);
    assert.equal((await manifest(project)).kind, 'static');
  });

  test('keeps _headers for the deploy tool', async () => {
    assert.match(await readFile(join(project, 'dist/client/_headers'), 'utf8'), /nosniff/);
  });

  test('writes Astro redirects into _redirects after the project rules', async () => {
    const lines = (await readFile(join(project, 'dist/client/_redirects'), 'utf8'))
      .trim()
      .split('\n');
    assert.match(lines[0]!, /^\/legacy\s+\/about\s+301$/);
    assert.ok(lines.some((line) => /^\/old\s+\/about\s+301$/.test(line)));
    assert.ok(lines.some((line) => /^\/temp\s+\/about\s+302$/.test(line)));
  });
});

describe('a prerendered site with one server island', () => {
  const project = fileURLToPath(new URL('../fixtures/static-islands/', import.meta.url));
  before(() => build({ root: project, logLevel: 'error' }));

  test('gets a script, because Astro emitted a server entry', async () => {
    assert.ok(existsSync(join(project, 'dist/index.js')));
    assert.equal((await manifest(project)).kind, 'ssr');
  });
});
