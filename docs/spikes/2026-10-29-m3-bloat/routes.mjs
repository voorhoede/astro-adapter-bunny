// usage: node routes.mjs <app dir>; prints every route of the spike app to check, one path per line.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const app = process.argv[2];
const names = (dir) => readdirSync(join(app, dir)).map((f) => f.replace(/\.(astro|mdx?)$/, ''));
const routes = ['/', '/blog', '/icons', '/icons?page=5', '/md', '/form', '/form?email=a@example.com&name=Ann&age=40', '/marker',
  ...['ts', 'css', 'html', 'json', 'python', 'rust', 'yaml', 'sql', 'all'].map((l) => `/code/${l}`),
  ...names('src/content/blog').map((n) => `/blog/${n}`), ...names('src/pages/p').map((n) => `/p/${n}`)];
console.log(routes.join('\n'));
