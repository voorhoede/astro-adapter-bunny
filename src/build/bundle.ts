import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { rollup, type OutputChunk, type RollupOutput } from 'rollup';

export type Chunk = { fileName: string; code: string; sha256: string; bytes: number };

export type ServerOutput = {
  entry: string;
  eager: string[];
  chunks: Chunk[];
  targets: Record<string, string[]>;
  builtins: string[];
};

const MIN_CHUNK_BYTES = 32 * 1024;
const PARTS_PER_TARGET = 8;
const EAGER_WARN_BYTES = 1024 * 1024;
const EAGER_FAIL_BYTES = 7 * 1024 * 1024;

const BUILTINS = new Set(builtinModules);
const UNSUPPORTED_BUILTINS = new Set([
  'child_process',
  'vm',
  'worker_threads',
  'constants',
  'path/win32',
]);

export async function bundle({
  dir,
  entry,
}: {
  dir: string;
  entry: string;
}): Promise<ServerOutput> {
  const builtins = new Set<string>();
  const build = await rollup({
    input: join(dir, entry),
    plugins: [
      {
        name: 'bunny-builtins',
        resolveId(id, importer) {
          if (id.startsWith('.') || id.startsWith('/') || importer === undefined) return null;
          const name = id.replace(/^node:/, '');
          const [root = name] = name.split('/');
          if (!BUILTINS.has(name) && !BUILTINS.has(root)) {
            throw new Error(`${id}, imported by ${importer}, was not bundled by Astro.`);
          }
          if (UNSUPPORTED_BUILTINS.has(name) || UNSUPPORTED_BUILTINS.has(root)) {
            throw new Error(`${id}, imported by ${importer}, does not run on bunny.net.`);
          }
          builtins.add(`node:${name}`);
          return { id: `node:${name}`, external: true };
        },
      },
    ],
  });
  const separate = chunksOf(await build.generate({ format: 'system' }));
  const merged = chunksOf(
    await build.generate({ format: 'system', experimentalMinChunkSize: MIN_CHUNK_BYTES }),
  );
  await build.close();

  // Merging can move a side-effect-free lazy module into the eager script or into another
  // lazy part, so it is kept only when every import() target still has a chunk of its own.
  const mergedTargets = targetsOf(merged);
  const keepsTargets = [...targetsOf(separate)].every((id) => mergedTargets.has(id));
  const generated = keepsTargets ? merged : separate;
  const byName = new Map(generated.map((chunk) => [chunk.fileName, chunk]));
  const closure = (fileName: string) =>
    new Set([...closureOf(byName, fileName)].map((c) => c.fileName));

  const entryChunk = generated.find((chunk) => chunk.isEntry);
  if (!entryChunk) throw new Error('Rollup produced no entry chunk for the server output.');
  const eager = closure(entryChunk.fileName);
  const routeTargets = new Set(
    [...eager].flatMap((fileName) => byName.get(fileName)?.dynamicImports ?? []),
  );
  const targets: Record<string, string[]> = {};
  for (const chunk of generated.filter((item) => item.isDynamicEntry)) {
    const files = [...closure(chunk.fileName)].filter((fileName) => !eager.has(fileName));
    if (routeTargets.has(chunk.fileName) && files.length > PARTS_PER_TARGET) {
      throw new Error(
        `The server part ${chunk.name} needs ${files.length} parts, more than the budget of ${PARTS_PER_TARGET}.`,
      );
    }
    targets[chunk.fileName] = files;
  }

  return {
    entry: entryChunk.fileName,
    eager: [...eager],
    chunks: generated.map((chunk) => ({
      fileName: chunk.fileName,
      code: chunk.code,
      sha256: createHash('sha256').update(chunk.code).digest('hex'),
      bytes: Buffer.byteLength(chunk.code),
    })),
    targets,
    builtins: [...builtins].toSorted(),
  };
}

function chunksOf({ output }: RollupOutput): OutputChunk[] {
  return output.filter((item): item is OutputChunk => item.type === 'chunk');
}

function closureOf(
  byName: Map<string, OutputChunk>,
  fileName: string,
  seen = new Set<OutputChunk>(),
) {
  const chunk = byName.get(fileName);
  if (!chunk || seen.has(chunk)) return seen;
  seen.add(chunk);
  for (const dependency of chunk.imports) closureOf(byName, dependency, seen);
  return seen;
}

function targetsOf(chunks: OutputChunk[]): Set<string | null> {
  return new Set(
    chunks.filter((chunk) => chunk.isDynamicEntry).map((chunk) => chunk.facadeModuleId),
  );
}

export function checkEagerSize(bytes: number): 'ok' | 'warn' {
  if (bytes > EAGER_FAIL_BYTES) {
    throw new Error(
      `The eager script is ${(bytes / 1024 / 1024).toFixed(1)} MB, above the 7 MB bunny.net reliably starts.`,
    );
  }
  return bytes > EAGER_WARN_BYTES ? 'warn' : 'ok';
}
