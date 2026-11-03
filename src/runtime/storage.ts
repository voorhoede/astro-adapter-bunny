import { keySegments } from '../routing/storage-key.ts';

const VARIABLES = ['BUNNY_STORAGE_ZONE', 'BUNNY_STORAGE_HOST', 'BUNNY_STORAGE_KEY'] as const;

export async function readStored(key: string, assetPrefix: string): Promise<Response | undefined> {
  const [zone, host, password] = VARIABLES.map((name) => {
    const value = process.env[name];
    if (!value) throw new Error(`Reading from storage needs the ${name} script variable.`);
    return value;
  });
  const path = [...keySegments(assetPrefix), ...keySegments(key)].map(encodeURIComponent).join('/');
  const response = await fetch(`https://${host}/${zone}/${path}`, {
    headers: { AccessKey: password ?? '' },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Storage answered ${response.status} for ${key}.`);
  return response;
}
