import { fileURLToPath } from 'node:url';
import type { AstroAdapter, AstroConfig, AstroUserConfig, HookParameters } from 'astro';

type BuildOutput = NonNullable<NonNullable<AstroAdapter['adapterFeatures']>['buildOutput']>;

type ConfigUpdate = Parameters<HookParameters<'astro:config:setup'>['updateConfig']>[0];

export type ImageServiceMode = 'compile' | 'passthrough' | 'custom';

const SHARP = 'astro/assets/services/sharp';
const NOOP = 'astro/assets/services/noop';
const BUNNY_CDN = fileURLToPath(new URL('../caching/bunny-cdn.ts', import.meta.url));

const PREVIEW = fileURLToPath(new URL('../preview/preview.ts', import.meta.url));

export function adapterConfig(buildOutput: BuildOutput, serverEntrypoint: string) {
  return {
    name: 'astro-adapter-bunny',
    serverEntrypoint,
    previewEntrypoint: PREVIEW,
    entrypointResolution: 'auto',
    adapterFeatures: {
      buildOutput,
      staticHeaders: buildOutput === 'server',
      preserveBuildClientDir: true,
      preserveBuildServerDir: true,
    },
    supportedAstroFeatures: {
      staticOutput: 'stable',
      hybridOutput: 'stable',
      serverOutput: 'stable',
      envGetSecret: 'stable',
      sharpImageService: 'limited',
      i18nDomains: 'unsupported',
    },
  } satisfies AstroAdapter;
}

// bunny.net runs Deno; Vite's own server defaults follow, since setting conditions replaces them.
const SERVER_CONDITIONS = ['deno', 'module', 'node', 'development|production'];

export function configOverrides(
  config: Partial<Pick<AstroConfig, 'site' | 'cache'>> & {
    image?: { service?: NonNullable<AstroUserConfig['image']>['service'] };
  },
  command: HookParameters<'astro:config:setup'>['command'] = 'build',
  imageService: ImageServiceMode = 'compile',
): ConfigUpdate {
  const service = config.image?.service;
  const usesSharp =
    service === undefined || ('entrypoint' in service && service.entrypoint === SHARP);
  const image = imageFor(imageService, usesSharp);
  return {
    build: { redirects: false },
    ...(command === 'dev'
      ? {}
      : { vite: { ssr: { noExternal: true, resolve: { conditions: SERVER_CONDITIONS } } } }),
    ...(image ? { image } : {}),
    ...(config.cache?.provider ? {} : { cache: { provider: cacheProvider(config.site) } }),
  };
}

function cacheProvider(site: string | undefined) {
  return { name: 'bunny.net CDN', entrypoint: BUNNY_CDN, config: site ? { site } : {} };
}

function imageFor(mode: ImageServiceMode, usesSharp: boolean) {
  if (mode === 'passthrough') return { service: { entrypoint: NOOP } };
  if (mode === 'compile' && usesSharp) {
    return { service: { build: { entrypoint: SHARP }, runtime: { entrypoint: NOOP } } };
  }
  return undefined;
}
