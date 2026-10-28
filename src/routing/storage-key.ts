export type Format = 'directory' | 'file';

export function storageKey(pathname: string, format: Format): string {
  const segments = keySegments(pathname);
  const last = segments.at(-1);
  if (last === undefined) return 'index.html';
  if (last.includes('.')) return segments.join('/');
  return format === 'directory'
    ? [...segments, 'index.html'].join('/')
    : `${segments.join('/')}.html`;
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
