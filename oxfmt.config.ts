import { defineConfig } from 'oxfmt';

export default defineConfig({
  singleQuote: true,
  printWidth: 100,
  ignorePatterns: ['docs/**', '*.md', 'package-lock.json'],
});
