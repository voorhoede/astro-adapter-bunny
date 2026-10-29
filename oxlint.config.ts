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
  overrides: [
    {
      // Inlined into the script as one expression, where it evaluates unpacked chunks.
      files: ['src/build/packed-loader.js'],
      rules: {
        'no-eval': 'off',
        'no-unused-expressions': 'off',
        'no-underscore-dangle': 'off',
        'unicorn/consistent-function-scoping': 'off',
      },
    },
  ],
});
