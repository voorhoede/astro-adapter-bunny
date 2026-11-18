import type { AstroConfig } from "astro";
import adapterPackage from "#package.json" with { type: "json" };
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// The shape bunny.net's CLI reads from `.bunny/build.json`; our own fields live under one key it ignores.
export async function writeBuildManifest(
  config: AstroConfig,
  {
    hasServer,
    hasRedirects,
    hasHeaders,
  }: { hasServer: boolean; hasRedirects: boolean; hasHeaders: boolean },
): Promise<void> {
  const root = fileURLToPath(config.root);
  const outDir = fileURLToPath(config.outDir);
  const fromRoot = (path: string) => relative(root, path).split(sep).join("/");

  const astro = await readJson(
    createRequire(join(root, "package.json")).resolve("astro/package.json"),
  );

  const clientDir = fileURLToPath(config.build.client);
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
    adapter: { package: adapterPackage.name, version: adapterPackage.version },
    framework: { name: "astro", version: astro.version },
    kind: hasServer ? "ssr" : "static",
    ...server,
    assets: { dir: fromRoot(clientDir) },
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
      ...(hasRedirects && {
        redirects: fromRoot(join(clientDir, "_redirects")),
      }),
      ...(hasHeaders && { headers: fromRoot(join(clientDir, "_headers")) }),
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
