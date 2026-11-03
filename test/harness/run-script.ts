import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export type ScriptRun = {
  loaded: boolean;
  error?: string;
  unpackedOnLoad: number;
  responses: Array<{ status: number; body: string; unpacked: number }>;
};

const runner = fileURLToPath(new URL('runner.js', import.meta.url));

export async function runScript(script: string, paths: string[] = []): Promise<ScriptRun> {
  const { stdout } = await promisify(execFile)(
    'deno',
    [
      'run',
      '--quiet',
      '--no-prompt',
      '--allow-env',
      `--allow-read=${script}`,
      runner,
      script,
      ...paths,
    ],
    { env: { PATH: process.env.PATH }, maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}
