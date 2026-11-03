import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, dev, preview } from 'astro';
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
      const run = await runScript(alone, [], { deploy: false });
      assert.equal(run.error, undefined);
      assert.equal(run.loaded, true);
    });

    test('/common, which requires a Node builtin from CommonJS, renders from the script', async () => {
      const [response] = (await runScript(join(root, 'dist/index.js'), ['/common'])).responses;
      assert.equal(response?.status, 200);
      assert.match(response?.body ?? '', /<p>a\/b<\/p>/);
    });

    test('a routeRules entry on an on-demand page caches it at the CDN through the default provider', async () => {
      const [response] = (await runScript(join(root, 'dist/index.js'), ['/cached'])).responses;
      assert.equal(response?.status, 200);
      assert.equal(
        response?.headers?.['cache-control'],
        'public, s-maxage=300, stale-while-revalidate=60',
      );
    });

    test('requires.env lists what the script type needs and the server secret, not the public variable', async () => {
      const names = (await manifest(root)).requires.env.map(
        (entry: { name: string }) => entry.name,
      );
      const storage = ['BUNNY_STORAGE_ZONE', 'BUNNY_STORAGE_HOST', 'BUNNY_STORAGE_KEY'];
      assert.deepEqual(names, [
        ...(script === 'standalone' ? storage : []),
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
      const [response] = (await runScript(join(root, 'dist/index.js'), ['/cookies'])).responses;
      assert.equal(response?.status, 200);
      assert.equal(response?.setCookies.length, 2);
      assert.match(response?.setCookies[1] ?? '', /Partitioned/);
    });

    test('Astro renders no meta refresh page for a redirect', () => {
      assert.equal(existsSync(join(root, 'dist/client/old/index.html')), false);
    });

    describe('through astro preview', () => {
      let server: Awaited<ReturnType<typeof preview>>;
      let origin: string;

      before(async () => {
        server = await preview({ root, logLevel: 'error', server: { port: 0 } });
        origin = `http://localhost:${server.port}`;
      });

      after(() => server.stop());

      test('a prerendered page comes from dist/client with the static Cache-Control', async () => {
        const response = await fetch(`${origin}/about`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
      });

      test('an on-demand page renders through the built script', async () => {
        const response = await fetch(`${origin}/common`);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /<p>a\/b<\/p>/);
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
      });

      test('a page keeps every cookie it sets', async () => {
        const response = await fetch(`${origin}/cookies`);
        assert.equal(response.headers.getSetCookie().length, 2);
      });

      test('a server secret is read from the environment', async () => {
        const response = await fetch(`${origin}/env`);
        assert.match(await response.text(), /token set/);
      });
    });
  });
}

describe('astro dev with the adapter', () => {
  let server: Awaited<ReturnType<typeof dev>>;

  before(async () => {
    server = await dev({ root, logLevel: 'error', server: { port: 4391 } });
  });

  after(() => server.stop());

  test('serves an on-demand page on the port it was given', async () => {
    const response = await fetch('http://localhost:4391/cookies');
    assert.equal(response.status, 200);
    assert.equal(response.headers.getSetCookie().length, 2);
  });
});

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

  describe('through astro preview', () => {
    let server: Awaited<ReturnType<typeof preview>>;
    let origin: string;

    before(async () => {
      server = await preview({ root: project, logLevel: 'error', server: { port: 0 } });
      origin = `http://localhost:${server.port}`;
    });

    after(() => server.stop());

    for (const [path, heading] of [
      ['/', 'home'],
      ['/about', 'about'],
      ['/about/', 'about'],
    ]) {
      test(`${path} is served from dist/client`, async () => {
        const response = await fetch(`${origin}${path}`);
        assert.equal(response.status, 200);
        assert.match(await response.text(), new RegExp(`<h1>${heading}</h1>`));
      });
    }

    test('a path with no file answers 404', async () => {
      const response = await fetch(`${origin}/nope`);
      assert.equal(response.status, 404);
    });
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
