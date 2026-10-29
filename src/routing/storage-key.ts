import type { AstroConfig } from 'astro';

export type Format = AstroConfig['build']['format'];

export type Page = { index: boolean };

export function storageKey(pathname: string, format: Format, page?: Page): string {
  const segments = keySegments(pathname);
  const last = segments.at(-1);
  if (last === undefined) return 'index.html';
  if (!page && last.includes('.')) return segments.join('/');
  const asIndex = format === 'directory' || (format === 'preserve' && (page?.index ?? true));
  return asIndex ? [...segments, 'index.html'].join('/') : `${segments.join('/')}.html`;
}

export function keySegments(pathname: string): string[] {
  return decodeOnce(pathname)
    .split(/[/\\]/)
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function decodeOnce(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}
