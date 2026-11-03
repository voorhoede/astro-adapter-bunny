const MB = 1024 * 1024;
const WARN_BYTES = 7 * MB;
const FAIL_BYTES = 10 * MB;
const NAMED_PACKAGES = 5;
const PROJECT = 'your project and virtual modules';

export type PackageSizes = Record<string, number>;

export function checkScriptSize(bytes: number, packages: PackageSizes): 'ok' | 'warn' {
  if (bytes > FAIL_BYTES) {
    const largest = Object.entries(packages)
      .toSorted(([, a], [, b]) => b - a)
      .slice(0, NAMED_PACKAGES)
      .map(([name, size]) => `  ${name}: ${megabytes(size)}`);
    throw new Error(
      [
        `The script is ${megabytes(bytes)}, above the 10 MB bunny.net accepts. The largest packages in it:`,
        ...largest,
      ].join('\n'),
    );
  }
  return bytes > WARN_BYTES ? 'warn' : 'ok';
}

export function packageSizes(modules: Iterable<[id: string, bytes: number]>): PackageSizes {
  const sizes: PackageSizes = {};
  for (const [id, bytes] of modules) {
    const name = packageOf(id) ?? PROJECT;
    sizes[name] = (sizes[name] ?? 0) + bytes;
  }
  return sizes;
}

function packageOf(id: string): string | undefined {
  const path = id.replaceAll('\\', '/');
  const at = path.lastIndexOf('/node_modules/');
  if (at === -1) return undefined;
  const [scope = '', name = ''] = path.slice(at + '/node_modules/'.length).split('/');
  return scope.startsWith('@') ? `${scope}/${name}` : scope;
}

function megabytes(bytes: number): string {
  return `${(bytes / MB).toFixed(1)} MB`;
}
