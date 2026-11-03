import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export type RequestSpec = {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export type ScriptResponse = {
  status: number;
  headers: Record<string, string>;
  setCookies: string[];
  body: string;
  reads: number;
};

export type ScriptRun = { loaded: boolean; error?: string; responses: ScriptResponse[] };

export type RunOptions = { client?: string; deploy?: boolean };

export const STORAGE_ENV = {
  BUNNY_STORAGE_ZONE: 'test-zone',
  BUNNY_STORAGE_HOST: 'storage.test',
  BUNNY_STORAGE_KEY: 'test-storage-key',
};

const runner = fileURLToPath(new URL('runner.js', import.meta.url));

export async function runScript(
  script: string,
  requests: Array<string | RequestSpec> = [],
  { client, deploy = true }: RunOptions = {},
): Promise<ScriptRun> {
  const specs = requests.map((request) =>
    typeof request === 'string' ? { path: request } : request,
  );
  const readable = client ? `${script},${client}` : script;
  const { stdout } = await promisify(execFile)(
    'deno',
    ['run', '--quiet', '--no-prompt', '--allow-env', `--allow-read=${readable}`, runner, script],
    {
      env: {
        PATH: process.env.PATH,
        ...STORAGE_ENV,
        RUN_OPTIONS: JSON.stringify({ requests: specs, client, deploy }),
      },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}
