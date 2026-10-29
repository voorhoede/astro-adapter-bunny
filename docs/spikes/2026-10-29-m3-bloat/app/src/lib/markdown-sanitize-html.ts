import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export function renderUserMarkdown(source: string): string {
  const html = marked.parse(source, { async: false });
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
    allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt'] },
  });
}
