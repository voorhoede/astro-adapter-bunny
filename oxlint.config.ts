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
  ignorePatterns: ['docs/**'],
});
