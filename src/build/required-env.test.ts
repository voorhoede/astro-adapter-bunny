import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requiredEnv } from './required-env.ts';

const adapter = [{ name: 'BUNNY_API_KEY', secret: true, optional: true }];

const storage = [
  { name: 'BUNNY_STORAGE_ZONE' },
  { name: 'BUNNY_STORAGE_HOST' },
  { name: 'BUNNY_STORAGE_KEY', secret: true },
];

test('a middleware script needs only the optional purge key, since it reads files through the CDN', () => {
  assert.deepEqual(requiredEnv(undefined, 'middleware'), adapter);
});

test('a standalone script also needs the storage variables, since it reads every file through the Storage API', () => {
  assert.deepEqual(requiredEnv(undefined, 'standalone'), [...storage, ...adapter]);
});

test('server secrets from the schema are added, in schema order', () => {
  const schema = {
    CMS_TOKEN: { context: 'server', access: 'secret', type: 'string' },
    PREVIEW_SECRET: { context: 'server', access: 'secret', type: 'string', optional: true },
    SEARCH_KEY: { context: 'server', access: 'secret', type: 'string', default: 'none' },
  } as const;
  assert.deepEqual(requiredEnv(schema, 'middleware'), [
    ...adapter,
    { name: 'CMS_TOKEN', secret: true },
    { name: 'PREVIEW_SECRET', secret: true, optional: true },
    { name: 'SEARCH_KEY', secret: true, optional: true },
  ]);
});

test('public variables are left out, since Astro inlines them at build', () => {
  const schema = {
    SITE_NAME: { context: 'client', access: 'public', type: 'string' },
    API_URL: { context: 'server', access: 'public', type: 'string' },
  } as const;
  assert.deepEqual(requiredEnv(schema, 'middleware'), adapter);
});
