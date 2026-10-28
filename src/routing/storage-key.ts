export type Format = 'directory' | 'file';

export function storageKey(pathname: string, format: Format): string {
  const segments = decodeOnce(pathname)
    .split(/[/\\]/)
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..');
  const last = segments.at(-1);
  if (last === undefined) return 'index.html';
  if (last.includes('.')) return segments.join('/');
  return format === 'directory'
    ? [...segments, 'index.html'].join('/')
    : `${segments.join('/')}.html`;
}

function decodeOnce(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}
