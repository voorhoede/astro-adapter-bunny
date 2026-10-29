import type { AstroAdapter, AstroUserConfig, HookParameters } from 'astro';

type BuildOutput = NonNullable<NonNullable<AstroAdapter['adapterFeatures']>['buildOutput']>;

type ConfigUpdate = Parameters<HookParameters<'astro:config:setup'>['updateConfig']>[0];

export type ImageServiceMode = 'compile' | 'passthrough' | 'custom';

const SHARP = 'astro/assets/services/sharp';
const NOOP = 'astro/assets/services/noop';

export function adapterConfig(buildOutput: BuildOutput, serverEntrypoint: string) {
  return {
    name: 'astro-adapter-bunny',
    serverEntrypoint,
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

export function configOverrides(
  config: { image?: { service?: NonNullable<AstroUserConfig['image']>['service'] } },
  command: HookParameters<'astro:config:setup'>['command'] = 'build',
  imageService: ImageServiceMode = 'compile',
): ConfigUpdate {
  const service = config.image?.service;
  const usesSharp =
    service === undefined || ('entrypoint' in service && service.entrypoint === SHARP);
  const image = imageFor(imageService, usesSharp);
  return {
    build: { redirects: false },
    ...(command === 'dev' ? {} : { vite: { ssr: { noExternal: true } } }),
    ...(image ? { image } : {}),
  };
}

function imageFor(mode: ImageServiceMode, usesSharp: boolean) {
  if (mode === 'passthrough') return { service: { entrypoint: NOOP } };
  if (mode === 'compile' && usesSharp) {
    return { service: { build: { entrypoint: SHARP }, runtime: { entrypoint: NOOP } } };
  }
  return undefined;
}
