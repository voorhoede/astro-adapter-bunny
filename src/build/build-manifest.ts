import type { EnvEntry } from './required-env.ts';

type Versions = { adapter: string; astro: string };

export type ManifestInput =
  | {
      kind: 'ssr';
      scriptType: 'standalone' | 'middleware';
      scriptBytes: number;
      assetsDir: string;
      env: EnvEntry[];
      versions: Versions;
    }
  | { kind: 'static'; assetsDir: string; env: EnvEntry[]; versions: Versions };

export function buildManifest(input: ManifestInput) {
  const common = {
    manifestVersion: 1,
    adapter: { package: 'astro-adapter-bunny', version: input.versions.adapter },
    framework: { name: 'astro', version: input.versions.astro },
  };
  const immutable = [`${input.assetsDir}/`];

  if (input.kind === 'static') {
    return { ...common, kind: 'static', assets: { dir: 'dist/client', immutable } };
  }
  return {
    ...common,
    kind: 'ssr',
    script: { entry: 'dist/index.js', type: input.scriptType, bytes: input.scriptBytes },
    assets: { dir: 'dist/client', immutable },
    requires: {
      pullZone: { disableCookies: false, enableSmartCache: false, enableCacheSlice: false },
      env: input.env,
    },
  };
}
