// usage: GEN_MB=<MB of generated server source> [PAGES=300] [POSTS=120] node gen.mjs
// Writes the generated half of the app: PAGES on-demand pages under src/pages/p, each importing its own module
// under src/gen that holds GEN_MB / PAGES of generated code, POSTS markdown and MDX posts, and locale data.
// The code is varied (identifiers, strings and numbers drawn from a large vocabulary) so brotli does not erase it.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const MB = Number(process.env.GEN_MB ?? 0);
const PAGES = Number(process.env.PAGES ?? 300);
const POSTS = Number(process.env.POSTS ?? 120);

let seed = 20261029;
const random = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const int = (n) => Math.floor(random() * n);
const pick = (a) => a[int(a.length)];

const syllables = 'ka ro mi te lu sa ne vo di pa ter mon gal fin bar sel dor vin quo lex tra pen cor ul im ab zen hal wy'.split(' ');
const vocabulary = Array.from({ length: 4000 }, () => Array.from({ length: 2 + int(3) }, () => pick(syllables)).join(''));
const word = () => pick(vocabulary);
const camel = (n) => Array.from({ length: n }, (_, i) => (i ? word().replace(/^./, (c) => c.toUpperCase()) : word())).join('');
const phrase = (n) => Array.from({ length: n }, word).join(' ');
const number = () => (random() < 0.5 ? int(1000) : +(random() * 100).toFixed(2));

function fn(name) {
  const local = Array.from({ length: 3 + int(4) }, () => camel(2));
  const key = () => camel(1 + int(2));
  const lines = [`function ${name}(input) {`, `  const ${local[0]} = input.items ?? [];`, `  let ${local[1]} = ${number()};`];
  for (let s = 0; s < 4 + int(6); s++) {
    switch (int(5)) {
      case 0:
        lines.push(`  for (const item of ${local[0]}) {`,
          `    if (item.${key()} === '${word()}') ${local[1]} += item.${key()} * ${number()};`,
          `    else if (item.${key()} > ${number()}) ${local[1]} -= ${number()};`, '  }');
        break;
      case 1:
        lines.push(`  switch (input.${key()}) {`);
        for (let c = 0; c < 2 + int(4); c++) lines.push(`    case '${word()}': ${local[1]} = ${local[1]} * ${number()} + ${number()}; break;`);
        lines.push(`    default: ${local[1]} += ${number()};`, '  }');
        break;
      case 2:
        lines.push(`  const ${local[2]}${s} = { ${Array.from({ length: 2 + int(5) }, () => `${key()}: '${phrase(2 + int(5))}'`).join(', ')} };`,
          `  if (input.q && ${local[2]}${s}[input.q]) ${local[1]} += ${local[2]}${s}[input.q].length;`);
        break;
      case 3:
        lines.push(`  const ${local[3]}${s} = [${Array.from({ length: 3 + int(6) }, number).join(', ')}].map((value, index) => value * (index + ${local[1]}) % ${1 + int(97)});`,
          `  ${local[1]} += ${local[3]}${s}.reduce((sum, value) => sum + value, 0);`);
        break;
      default:
        lines.push(`  if (String(input.q ?? '').startsWith('${word().slice(0, 3)}')) {`,
          `    ${local[1]} = Math.round(${local[1]} * ${number()}) / ${1 + int(9)};`,
          `  } else {`, `    ${local[1]} = Math.max(${local[1]}, ${number()});`, '  }');
    }
  }
  lines.push(`  return { name: '${name}', label: '${phrase(3 + int(4))}', value: ${local[1]} };`, '}');
  return lines.join('\n');
}

function module(bytes) {
  const names = [];
  const parts = [];
  let size = 0;
  while (size < bytes) {
    const name = camel(3);
    const code = fn(name);
    names.push(name);
    parts.push(code);
    size += code.length;
  }
  parts.push(`export function run(input) {\n  return [${names.map((n) => `${n}(input)`).join(', ')}];\n}`);
  return parts.join('\n\n');
}

for (const dir of ['src/gen', 'src/pages/p', 'src/content/blog']) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

const perModule = (MB * 1024 * 1024) / PAGES;
for (let p = 0; p < PAGES; p++) {
  const id = String(p).padStart(3, '0');
  writeFileSync(`src/gen/mod-${id}.ts`, `// @ts-nocheck\n${perModule > 0 ? module(perModule) : 'export function run() {\n  return [];\n}'}\n`);
  writeFileSync(`src/pages/p/page-${id}.astro`, `---
import Base from '../../layouts/Base.astro';
import { run } from '../../gen/mod-${id}.ts';
import { summarize } from '../../lib/summary.ts';
export const prerender = false;
const q = Astro.url.searchParams.get('q') ?? '${word()}';
const results = run({ q, items: [{ kind: '${word()}', price: ${number()} }] });
const summary = summarize(results);
---
<Base title="Page ${id}" icon="${pick(['home', 'account', 'calendar', 'chart-line', 'cog', 'email', 'file-document', 'map-marker'])}">
  <h1>Page ${id}: ${phrase(4)}</h1>
  <p>${phrase(30)}</p>
  <p>{summary.count} results, total {summary.total}</p>
  <ul>{summary.top.map((r) => <li>{r.label}: {r.value}</li>)}</ul>
</Base>
`);
}

const languages = ['en', 'nl', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'sv', 'da', 'fi', 'nb', 'cs', 'hu', 'ro', 'tr', 'el', 'ja', 'ko', 'zh'];
const keys = Array.from({ length: 400 }, () => camel(2));
writeFileSync('src/gen/locales.json', JSON.stringify(Object.fromEntries(languages.map((lng) => [lng, {
  translation: Object.fromEntries(keys.map((k) => [k, phrase(3 + int(10))])),
}]))));
writeFileSync('src/gen/keys.json', JSON.stringify(keys));

for (let p = 0; p < POSTS; p++) {
  const id = String(p).padStart(3, '0');
  const date = new Date(Date.UTC(2024, 0, 1) + p * 3 * 86400000).toISOString().slice(0, 10);
  const mdx = p % 4 === 0;
  const body = Array.from({ length: 6 }, (_, i) => `## ${phrase(3)}\n\n${phrase(60)}\n\n${i % 2 ? `- ${phrase(5)}\n- ${phrase(6)}\n- ${phrase(4)}\n` : `\`\`\`ts\nconst ${camel(2)} = ${number()};\nexport function ${camel(2)}(x: number) {\n  return x * ${number()};\n}\n\`\`\`\n`}`).join('\n\n');
  writeFileSync(`src/content/blog/post-${id}.${mdx ? 'mdx' : 'md'}`, `---
title: "${phrase(5)}"
date: ${date}
tags: [${Array.from({ length: 3 }, () => `"${pick(vocabulary.slice(0, 20))}"`).join(', ')}]
---
${mdx ? `import Callout from '../../components/Callout.astro';\n\n<Callout kind="note">${phrase(12)}</Callout>\n\n` : ''}${body}
`);
}
// SANITIZER=sanitize-html reproduces the createRequire failure under the packed loader; xss is the default.
writeFileSync('src/gen/markdown.ts', `export * from '../lib/markdown-${process.env.SANITIZER ?? 'xss'}.ts';\n`);
writeFileSync('src/gen/marker.ts', `export const marker = 'bloat-${MB}-${Date.now().toString(36)}';\n`);
console.log(`generated ${PAGES} pages with ${(perModule * PAGES / 1024 / 1024).toFixed(1)} MB of code, ${POSTS} posts`);
