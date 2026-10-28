import type { HeaderRule } from '../caching/index.ts';

export function parseHeadersFile(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const fail = (reason: string) => new Error(`_headers:${index + 1}: ${reason}`);
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    if (!/^\s/.test(line)) {
      const path = line.trim();
      if (path.split('*').length > 2) throw fail('a path can hold one splat.');
      rules.push({ path, set: [], detach: [] });
      continue;
    }

    const rule = rules.at(-1);
    if (!rule) throw fail('a header line needs a path on a line above it.');
    const content = line.trim();
    if (content.startsWith('!')) {
      rule.detach.push(content.slice(1).trim());
      continue;
    }
    const colon = content.indexOf(':');
    if (colon <= 0) throw fail('a header line reads "Name: value".');
    rule.set.push([content.slice(0, colon).trim(), content.slice(colon + 1).trim()]);
  }
  return rules;
}
