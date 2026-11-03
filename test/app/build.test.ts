import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'astro';
import { parseSync } from 'rolldown/utils';
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

// Astro carries its client island code as strings, so only a parse tells a runtime import() apart.
function importExpressions(code: string): number {
  const count = (node: unknown): number => {
    if (Array.isArray(node)) return node.reduce((sum: number, child) => sum + count(child), 0);
    if (node === null || typeof node !== 'object') return 0;
    const own = 'type' in node && node.type === 'ImportExpression' ? 1 : 0;
    return own + Object.values(node).reduce((sum: number, child) => sum + count(child), 0);
  };
  return count(parseSync('index.js', code).program);
}

type Handler = (request: Request) => Promise<Response>;

// Loads Astro's server build in Node, with a stand-in for the Bunny global it registers its handler on.
async function serverHandler(tag: string): Promise<Handler> {
  let registered: Handler | undefined;
  Object.assign(globalThis, {
    Bunny: { v1: { serve: (handler: Handler) => (registered = handler) } },
  });
  await import(`${join(root, 'dist/server/entry.mjs')}?${tag}`);
  assert.ok(registered, 'the server build registered no handler');
  return registered;
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

    test('the client directory holds no server code, and the manifest reserves no path', async () => {
      assert.equal(existsSync(join(root, 'dist/client/_bunny')), false);
      assert.equal((await manifest(root)).assets.reserved, undefined);
    });

    test('the manifest gives the size of the script', async () => {
      const { size } = await stat(join(root, 'dist/index.js'));
      assert.equal((await manifest(root)).script.bytes, size);
    });

    test('the script, copied alone, loads without the deploy global and imports nothing at runtime', async () => {
      const alone = join(await mkdtemp(join(tmpdir(), 'script-')), 'index.js');
      await copyFile(join(root, 'dist/index.js'), alone);
      assert.equal(importExpressions(await readFile(alone, 'utf8')), 0);
      const run = await runScript(alone);
      assert.equal(run.error, undefined);
      assert.equal(run.loaded, true);
    });

    test('/common, which requires a Node builtin from CommonJS, renders from the script with the same HTML as the server build', async () => {
      const handle = await serverHandler(`common-${script}`);
      const expected = await handle(new Request('https://example.com/common'));
      const [response] = (await runScript(join(root, 'dist/index.js'), ['/common'])).responses;
      assert.equal(response?.status, 200);
      assert.equal(response?.body, await expected.text());
    });

    test('a routeRules entry on an on-demand page caches it at the CDN through the default provider', async () => {
      const [response] = (await runScript(join(root, 'dist/index.js'), ['/cached'])).responses;
      assert.equal(response?.status, 200);
      assert.equal(
        response?.headers?.['cache-control'],
        'public, s-maxage=300, stale-while-revalidate=60',
      );
    });

    test('requires.env lists the storage variables and the server secret, not the public variable', async () => {
      const names = (await manifest(root)).requires.env.map(
        (entry: { name: string }) => entry.name,
      );
      assert.deepEqual(names, [
        'BUNNY_STORAGE_ZONE',
        'BUNNY_STORAGE_HOST',
        'BUNNY_STORAGE_KEY',
        'BUNNY_API_KEY',
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
      assert.doesNotMatch(
        await readFile(join(root, 'dist/index.js'), 'utf8'),
        /detect-libc|sharp-libvips/,
      );
    });

    test('a rendered page keeps every cookie it sets', async () => {
      const handle = await serverHandler(`cookies-${script}`);
      const response = await handle(new Request('https://example.com/cookies'));
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

describe('a site with one Astro <Code> block', () => {
  const project = fileURLToPath(new URL('../fixtures/oversize/', import.meta.url));

  test('fails the build above 10 MB, naming Shiki among the largest packages', async () => {
    await assert.rejects(build({ root: project, logLevel: 'silent' }), (error: Error) => {
      assert.match(error.message, /10 MB/);
      assert.match(error.message, /@shikijs\/langs/);
      return true;
    });
  });
});
