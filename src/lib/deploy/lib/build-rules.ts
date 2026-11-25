import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { BuildManifest } from "./build-manifest.ts";
import { type EdgeRule, edgeRules } from "./edge-rules.ts";

/** Reads what the edge rules of a build depend on, and returns those rules. */
export async function rulesForBuild(
  root: string,
  manifest: BuildManifest,
): Promise<{ rules: EdgeRule[]; warnings: string[] }> {
  const { redirects, headers, base, assetsDir, trailingSlash } =
    manifest.astroAdapterBunny;
  const clientDir = join(root, manifest.assets.dir);
  const read = (file?: string) =>
    file ? readFile(join(root, file), "utf8") : Promise.resolve("");

  const files = (await readdir(clientDir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(clientDir, join(entry.parentPath, entry.name)).split(sep).join("/"),
    );

  return edgeRules({
    hasScript: manifest.script !== undefined,
    base,
    assetsDir,
    trailingSlash,
    redirects: await read(redirects),
    headers: await read(headers),
    filesWithoutExtension: files.filter(
      (file) => !/\.[^/]+$/.test(file) && !["_redirects", "_headers"].includes(file),
    ),
  });
}
