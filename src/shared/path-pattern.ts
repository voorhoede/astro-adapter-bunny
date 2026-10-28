export type Captures = Record<string, string>;

const TOKEN = /\*|:[A-Za-z]\w*/g;

export function matchPath(pattern: string, pathname: string): Captures | undefined {
  let source = '';
  let index = 0;
  for (const token of pattern.matchAll(TOKEN)) {
    source += escape(pattern.slice(index, token.index));
    source += token[0] === '*' ? '(?<splat>.*)' : `(?<${token[0].slice(1)}>[^/]+)`;
    index = token.index + token[0].length;
  }
  source += escape(pattern.slice(index));
  const result = new RegExp(`^${source}$`).exec(pathname);
  return result ? { ...result.groups } : undefined;
}

export function fill(template: string, captures: Captures): string {
  return template.replace(TOKEN, (token) =>
    token === '*' ? token : (captures[token.slice(1)] ?? token),
  );
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
