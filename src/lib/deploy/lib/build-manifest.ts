import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The part of `.bunny/build.json` the deploy reads; write-build-manifest.ts writes it.
export type BuildManifest = {
  kind: "ssr" | "static";
  script?: { entry: string; type: "middleware"; bytes: number };
  assets: { dir: string };
  requires?: {
    env?: { name: string; secret: boolean; optional?: boolean }[];
  };
  astroAdapterBunny: {
    trailingSlash: "always" | "never" | "ignore";
    base: string;
    buildFormat: "directory" | "file" | "preserve";
    assetsDir: string;
    redirects?: string;
    headers?: string;
  };
};

export const MANIFEST_FILE = join(".bunny", "build.json");

/** Reads the manifest the adapter wrote, so a deploy fails before it touches bunny.net when there is no build. */
export async function readBuildManifest(root: string): Promise<BuildManifest> {
  let text: string;
  try {
    text = await readFile(join(root, MANIFEST_FILE), "utf8");
  } catch {
    throw new Error(
      `No ${MANIFEST_FILE} in ${root}. Build the site with astro-adapter-bunny before deploying it.`,
    );
  }

  return JSON.parse(text) as BuildManifest;
}
