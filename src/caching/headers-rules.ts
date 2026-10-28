import { fill, matchPath } from '../shared/path-pattern.ts';

export type HeaderRule = { path: string; set: Array<[string, string]>; detach: string[] };

export function headersFor(rules: HeaderRule[], pathname: string): Array<[string, string]> {
  const headers = new Map<string, [string, string]>();
  for (const rule of rules) {
    const captures = matchPath(rule.path, pathname);
    if (!captures) continue;
    for (const name of rule.detach) headers.delete(name.toLowerCase());
    for (const [name, template] of rule.set) {
      const value = fill(template, captures);
      const existing = headers.get(name.toLowerCase());
      headers.set(
        name.toLowerCase(),
        existing ? [existing[0], `${existing[1]}, ${value}`] : [name, value],
      );
    }
  }
  return [...headers.values()];
}
