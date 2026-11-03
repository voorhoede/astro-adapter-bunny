import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkScriptSize, packageSizes } from './script-size.ts';

const MB = 1024 * 1024;

test('a script up to 7 MB passes, and above it warns', () => {
  assert.equal(checkScriptSize(6.5 * MB, {}), 'ok');
  assert.equal(checkScriptSize(7.5 * MB, {}), 'warn');
});

test('a script above 10 MB fails, naming the five largest packages, largest first', () => {
  const packages = {
    '@shikijs/langs': 8.6 * MB,
    '@shikijs/themes': 1.5 * MB,
    astro: 0.5 * MB,
    zod: 0.2 * MB,
    'left-pad': 0.1 * MB,
    tiny: 0.01 * MB,
  };
  assert.throws(
    () => checkScriptSize(10.5 * MB, packages),
    (error: Error) => {
      assert.match(error.message, /10\.5 MB/);
      assert.match(error.message, /10 MB/);
      const named = ['@shikijs/langs', '@shikijs/themes', 'astro', 'zod', 'left-pad'];
      const positions = named.map((name) => error.message.indexOf(name));
      assert.ok(positions.every((position) => position >= 0));
      assert.deepEqual(
        positions,
        positions.toSorted((a, b) => a - b),
      );
      assert.doesNotMatch(error.message, /tiny/);
      return true;
    },
  );
});

test('module sizes add up per package, scoped packages included', () => {
  assert.deepEqual(
    packageSizes([
      ['/site/node_modules/@shikijs/langs/dist/abap.mjs', 100],
      ['/site/node_modules/@shikijs/langs/dist/ada.mjs', 50],
      ['/site/node_modules/astro/dist/core/app.js', 30],
      ['/site/node_modules/a/node_modules/b/index.js', 20],
      ['C:\\site\\node_modules\\zod\\index.js', 10],
    ]),
    { '@shikijs/langs': 150, astro: 30, b: 20, zod: 10 },
  );
});

test('code outside node_modules counts as the project', () => {
  assert.deepEqual(
    packageSizes([
      ['/site/src/pages/index.astro', 40],
      ['\0virtual:astro:manifest', 5],
    ]),
    { 'your project and virtual modules': 45 },
  );
});
