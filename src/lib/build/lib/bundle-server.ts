import { builtinModules } from "node:module";
import { join } from "node:path";
import { rolldown } from "rolldown";

export type ServerBundle = {
  code: string;
  /** Every module the script imports at runtime, static or dynamic. */
  imports: string[];
};

export async function bundleServer(
  serverLocation: string,
  serverEntryFile: string,
): Promise<ServerBundle> {
  const build = await rolldown({
    input: join(serverLocation, serverEntryFile),
    platform: "node",
    plugins: [
      {
        name: "node-prefix",
        // bunny.net only resolves Node builtins by their `node:` name.
        resolveId(source) {
          const name = source.replace(/^node:/, "");
          return builtinModules.includes(name)
            ? { id: `node:${name}`, external: true, moduleSideEffects: false }
            : null;
        },
      },
    ],
  });
  const {
    output: [bundle],
  } = await build.generate({
    format: "esm",
    codeSplitting: false,
  });
  await build.close();

  return {
    code: bundle.code,
    imports: [...bundle.imports, ...bundle.dynamicImports],
  };
}
