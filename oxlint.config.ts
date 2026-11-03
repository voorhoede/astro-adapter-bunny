import { defineConfig } from 'oxlint';

export default defineConfig({
  plugins: ['typescript', 'unicorn', 'oxc', 'import', 'node'],
  categories: {
    correctness: 'error',
    suspicious: 'error',
    perf: 'warn',
  },
  env: {
    builtin: true,
  },
  rules: {
    // Global names fixed by the deploy line and the build, not by this code.
    'no-underscore-dangle': ['error', { allow: ['__BUNNY_DEPLOY__', '__BUNNY_SITE__'] }],
  },
  ignorePatterns: ['docs/**'],
});
