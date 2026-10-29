import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { builtinModules, createRequire } from 'node:module';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { minify } from 'rolldown/utils';
import type { AstroIntegrationLogger } from 'astro';
import { rollup, type OutputChunk, type RollupOutput } from 'rollup';

export type BuildLogger = Pick<AstroIntegrationLogger, 'warn' | 'info' | 'debug'>;

export type Script = { code: string; map: string; wasm: boolean; builtins: string[] };

const SCRIPT_WARN_BYTES = 4 * 1024 * 1024;
const SCRIPT_FAIL_BYTES = 7 * 1024 * 1024;

const BUILTINS = new Set(builtinModules);
const UNSUPPORTED_BUILTINS = new Set([
  'child_process',
  'vm',
  'worker_threads',
  'constants',
  'path/win32',
]);

// Shiki inlines its WebAssembly as base64 and decodes it on every cold start.
const WASM_LITERAL =
  /Uint8Array\.from\(atob\("([A-Za-z0-9+/=]+)"\), \(c\) => c\.charCodeAt\(0\)\)/g;
const WASM_REFERENCE = /globalThis\.__bunnyWasm\[(\d+)\]/g;
const CREATE_REQUIRE = 'createRequire(import.meta.url)';
const REQUIRE_CALL = /\b__require\w*\(\s*"([^"]+)"\s*\)/g;
const MANIFEST_CALL = 'deserializeManifest(';
const SOURCE_MAP_COMMENT = /\n?\/\/# sourceMappingURL=\S*\s*$/;

const require = createRequire(import.meta.url);

export async function bundle({
  dir,
  entry,
  logger,
}: {
  dir: string;
  entry: string;
  logger: BuildLogger;
}): Promise<Script> {
  const builtins = new Set<string>();
  const wasm: Buffer[] = [];
  const builtin = (id: string, by: string) => {
    const name = id.replace(/^node:/, '');
    const [root = name] = name.split('/');
    if (!BUILTINS.has(name) && !BUILTINS.has(root)) {
      throw new Error(`${id}, ${by}, was not bundled by Astro.`);
    }
    if (UNSUPPORTED_BUILTINS.has(name) || UNSUPPORTED_BUILTINS.has(root)) {
      throw new Error(`${id}, ${by}, does not run on bunny.net.`);
    }
    builtins.add(`node:${name}`);
    return `node:${name}`;
  };
  const build = await rollup({
    input: join(dir, entry),
    onLog: (level, log) => logger[level](log.message),
    plugins: [
      {
        name: 'bunny-builtins',
        resolveId(id, importer) {
          if (id.startsWith('.') || id.startsWith('/') || importer === undefined) return null;
          return { id: builtin(id, `imported by ${importer}`), external: true };
        },
        // A packed chunk has no file URL, so createRequire(import.meta.url) cannot work there.
        transform(code, id) {
          for (const [, request = ''] of code.matchAll(REQUIRE_CALL)) {
            builtin(request, `required by ${id}`);
          }
          if (!code.includes(CREATE_REQUIRE)) return null;
          return { code: code.replaceAll(CREATE_REQUIRE, 'globalThis.__bunnyRequire'), map: null };
        },
      },
      {
        name: 'bunny-pack',
        async renderChunk(code, chunk) {
          const rewritten = stripServerEntries(code, dir).replace(WASM_LITERAL, (_, base64) => {
            wasm.push(Buffer.from(base64, 'base64'));
            return `globalThis.__bunnyWasm[${wasm.length - 1}]`;
          });
          const result = await minify(chunk.fileName, rewritten, {
            compress: { keepNames: { function: true, class: true } },
            mangle: { keepNames: true },
            codegen: { legalComments: 'inline' },
            sourcemap: true,
          });
          if (result.errors.length > 0) {
            throw new Error(`Minifying ${chunk.fileName} failed: ${result.errors[0]?.message}`);
          }
          return { code: result.code, map: result.map ?? null };
        },
      },
    ],
  });
  const chunks = chunksOf(await build.generate({ format: 'system', sourcemap: true }));
  await build.close();

  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const entryChunk = chunks.find((chunk) => chunk.isEntry);
  if (!entryChunk) throw new Error('Rollup produced no entry chunk for the server output.');
  const eager = closureOf(byName, entryChunk.fileName);
  const lazy = chunks.filter((chunk) => !eager.has(chunk));

  const systemjs = await readFile(require.resolve('systemjs/dist/s.min.js'), 'utf8');
  const loader = await readFile(new URL('packed-loader.js', import.meta.url), 'utf8');
  const imports = [...builtins].map((id, index) => `import * as builtin${index} from '${id}';`);

  const lines: string[] = [];
  const sections: Array<{ offset: { line: number; column: number }; map: unknown }> = [];
  const add = (text: string) => lines.push(...text.split('\n'));
  add(imports.join('\n'));
  add(systemjs.replace(SOURCE_MAP_COMMENT, ''));
  add(`const respond = ${loader.trim().replace(/;$/, '')}({`);
  add(`entry: ${JSON.stringify(entryChunk.fileName)},`);
  add(
    `builtins: {${[...builtins].map((id, index) => `${JSON.stringify(id)}: builtin${index}`).join(', ')}},`,
  );
  add('inline: {');
  for (const chunk of eager) {
    add(`${JSON.stringify(chunk.fileName)}: function () {`);
    if (chunk.map) sections.push({ offset: { line: lines.length, column: 0 }, map: chunk.map });
    add(withoutMapComment(chunk.code));
    add('},');
  }
  add('},');
  add(
    `packed: ${JSON.stringify(Object.fromEntries(lazy.map((chunk) => [chunk.fileName, packed(withoutMapComment(chunk.code))])))},`,
  );
  add(`wasm: ${JSON.stringify(wasm.map(packedBytes))},`);
  add(`wasmOf: ${JSON.stringify(Object.fromEntries(chunks.flatMap(wasmIdsOf)))},`);
  add('});');
  add('Bunny.v1.serve(respond);');

  return {
    code: `${lines.join('\n')}\n`,
    map: JSON.stringify({ version: 3, file: 'index.js', sections }),
    wasm: wasm.length > 0,
    builtins: [...builtins].toSorted(),
  };
}

export function checkScriptSize(bytes: number): 'ok' | 'warn' {
  if (bytes > SCRIPT_FAIL_BYTES) {
    throw new Error(
      `The script is ${(bytes / 1024 / 1024).toFixed(1)} MB, above the 7 MB bunny.net reliably starts.`,
    );
  }
  return bytes > SCRIPT_WARN_BYTES ? 'warn' : 'ok';
}

function chunksOf({ output }: RollupOutput): OutputChunk[] {
  return output.filter((item): item is OutputChunk => item.type === 'chunk');
}

function closureOf(
  byName: Map<string, OutputChunk>,
  fileName: string,
  seen = new Set<OutputChunk>(),
): Set<OutputChunk> {
  const chunk = byName.get(fileName);
  if (!chunk || seen.has(chunk)) return seen;
  seen.add(chunk);
  for (const dependency of chunk.imports) closureOf(byName, dependency, seen);
  return seen;
}

function withoutMapComment(code: string): string {
  return code.replace(SOURCE_MAP_COMMENT, '');
}

function packed(code: string): string {
  return packedBytes(Buffer.from(code));
}

function packedBytes(bytes: Buffer): string {
  return brotliCompressSync(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  }).toString('base64');
}

function wasmIdsOf(chunk: OutputChunk): Array<[string, number[]]> {
  const ids = [...chunk.code.matchAll(WASM_REFERENCE)].map((match) => Number(match[1]));
  return ids.length > 0 ? [[chunk.fileName, ids]] : [];
}

function stripServerEntries(code: string, dir: string): string {
  const call = code.indexOf(`${MANIFEST_CALL}{`);
  if (call === -1) return code;
  const start = call + MANIFEST_CALL.length;
  const end = endOfObject(code, start);
  const manifest = JSON.parse(code.slice(start, end));
  if (!manifest.entryModules) return code;
  manifest.entryModules = Object.fromEntries(
    Object.entries(manifest.entryModules).filter(
      ([, file]) => !(typeof file === 'string' && file !== '' && existsSync(join(dir, file))),
    ),
  );
  return code.slice(0, start) + JSON.stringify(manifest) + code.slice(end);
}

function endOfObject(code: string, start: number): number {
  let depth = 0;
  for (let index = start; index < code.length; index++) {
    const character = code[index];
    if (character === '"') {
      for (index++; code[index] !== '"'; index++) if (code[index] === '\\') index++;
    } else if (character === '{' || character === '[') {
      depth++;
    } else if ((character === '}' || character === ']') && --depth === 0) {
      return index + 1;
    }
  }
  throw new Error('The server manifest literal is not terminated.');
}
