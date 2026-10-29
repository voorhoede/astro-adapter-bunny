import { marked } from 'marked';
import { filterXSS } from 'xss';

export function renderUserMarkdown(source: string): string {
  return filterXSS(marked.parse(source, { async: false }));
}
