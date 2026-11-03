import type { AstroConfig } from 'astro';

export type EnvEntry = { name: string; secret?: true; optional?: true };

const STORAGE: EnvEntry[] = [
  { name: 'BUNNY_STORAGE_ZONE' },
  { name: 'BUNNY_STORAGE_HOST' },
  { name: 'BUNNY_STORAGE_KEY', secret: true },
  { name: 'BUNNY_API_KEY', secret: true, optional: true },
];

export function requiredEnv(schema: AstroConfig['env']['schema'] | undefined): EnvEntry[] {
  const secrets = Object.entries(schema ?? {})
    .filter(([, field]) => field.context === 'server' && field.access === 'secret')
    .map(([name, field]): EnvEntry => {
      const optional = field.optional === true || field.default !== undefined;
      return optional ? { name, secret: true, optional: true } : { name, secret: true };
    });
  return [...STORAGE, ...secrets];
}
