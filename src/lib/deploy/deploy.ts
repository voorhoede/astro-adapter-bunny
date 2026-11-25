import { loadConfig } from "./lib/config.ts";
import { branchName, pullZoneUrl, releaseName } from "./lib/names.ts";

export { defineConfig } from "./lib/config.ts";
export type { BunnyConfig, StorageTier } from "./lib/config.ts";

export type Options = {
  /** The project root, with `bunny.config.ts` and the build. Defaults to the working directory. */
  root?: string;
};

/**
 * The URL a branch or a commit answers on. A workflow passes a branch's URL to
 * the build as `site`, before anything of the release exists.
 */
export async function url(
  target: { branch: string } | { commit: string },
  { root = process.cwd() }: Options = {},
): Promise<string> {
  const { name } = await loadConfig(root);

  if ("branch" in target) return pullZoneUrl(branchName(name, target.branch));
  return pullZoneUrl(releaseName(name, target.commit));
}
