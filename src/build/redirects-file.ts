import type { RedirectRule } from '../routing/index.ts';

const STATUSES = new Set([200, 301, 302, 303, 307, 308]);

export function parseRedirectsFile(text: string): RedirectRule[] {
  const rules: RedirectRule[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const fail = (reason: string) => new Error(`_redirects:${index + 1}: ${reason}`);
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    const [from, to, code] = line.trim().split(/\s+/);
    if (from === undefined || to === undefined) throw fail('a rule reads "from to [status]".');
    if (from.includes('?')) throw fail('query conditions are not supported.');
    if (from.split('*').length > 2) throw fail('a source can hold one splat.');
    if (code === undefined) {
      rules.push({ from, to });
      continue;
    }

    const status = Number(code);
    if (!STATUSES.has(status))
      throw fail(`status ${code} is not one of 200, 301, 302, 303, 307, 308.`);
    if (status === 200 && /^[a-z]+:\/\//i.test(to))
      throw fail('a 200 rule cannot serve another site.');
    rules.push({ from, to, status });
  }
  return rules;
}
