import type { AstroConfig } from "astro";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// The shape bunny.net's CLI reads from `.bunny/build.json`; our own fields live under one key it ignores.
export async function writeBuildManifest(
  config: AstroConfig,
  { hasServer, hasRedirects }: { hasServer: boolean; hasRedirects: boolean },
): Promise<void> {
  const root = fileURLToPath(config.root);
  const outDir = fileURLToPath(config.outDir);
  const fromRoot = (path: string) => relative(root, path).split(sep).join("/");

  const adapter = await readJson(
    new URL("../../package.json", import.meta.url),
  );
  const astro = await readJson(
    createRequire(join(root, "package.json")).resolve("astro/package.json"),
  );

  const scriptFile = join(outDir, "index.js");
  const server = hasServer && {
    script: {
      entry: fromRoot(scriptFile),
      type: "middleware",
      bytes: (await stat(scriptFile)).size,
    },
  };

  const env = Object.entries(config.env.schema)
    .filter(([, field]) => field.access === "secret")
    .map(([name, field]) => ({
      name,
      reason: "astro:env secret",
      secret: true,
      ...(("optional" in field && field.optional) || "default" in field
        ? { optional: true }
        : {}),
    }));

  const manifest = {
    manifestVersion: 1,
    adapter: { package: adapter.name, version: adapter.version },
    framework: { name: "astro", version: astro.version },
    kind: hasServer ? "ssr" : "static",
    ...server,
    assets: { dir: fromRoot(fileURLToPath(config.build.client)) },
    ...(hasServer && {
      requires: {
        pullZone: { disableCookies: false, enableSmartCache: false },
        ...(env.length > 0 && { env }),
      },
      dev: { command: "astro dev" },
    }),
    astroAdapterBunny: {
      trailingSlash: config.trailingSlash,
      base: config.base,
      buildFormat: config.build.format,
      assetsDir: config.build.assets,
      ...(hasRedirects && { redirects: fromRoot(join(outDir, "_redirects")) }),
      deployFolderHeader: "X-Bunny-Deploy",
    },
  };

  const file = join(root, ".bunny", "build.json");
  await mkdir(join(root, ".bunny"), { recursive: true });
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function readJson(
  path: string | URL,
): Promise<{ name: string; version: string }> {
  return JSON.parse(await readFile(path, "utf8"));
}
