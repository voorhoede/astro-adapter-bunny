type EnvField = {
  context: 'server' | 'client';
  access: 'secret' | 'public';
  optional?: boolean;
  default?: unknown;
};

export type EnvEntry = { name: string; secret?: true; optional?: true };

const STORAGE: EnvEntry[] = [
  { name: 'BUNNY_STORAGE_ZONE' },
  { name: 'BUNNY_STORAGE_HOST' },
  { name: 'BUNNY_STORAGE_KEY', secret: true },
];

export function requiredEnv(schema: Record<string, EnvField> | undefined): EnvEntry[] {
  const secrets = Object.entries(schema ?? {})
    .filter(([, field]) => field.context === 'server' && field.access === 'secret')
    .map(([name, field]): EnvEntry => {
      const optional = field.optional === true || field.default !== undefined;
      return optional ? { name, secret: true, optional: true } : { name, secret: true };
    });
  return [...STORAGE, ...secrets];
}
