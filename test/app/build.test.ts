import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'astro';

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

    test('server parts are written under _bunny/server in the client directory', async () => {
      const parts = await files(join(root, 'dist/client/_bunny/server'));
      assert.ok(parts.length > 0);
      for (const [, code] of await contents(parts)) assert.match(code, /^System\.register\(/);
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
      for (const [, code] of await contents(await files(join(root, 'dist/client/_bunny/server')))) {
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
