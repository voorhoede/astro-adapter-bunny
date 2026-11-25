import { readBuildManifest } from "./lib/build-manifest.ts";
import { createBunnyApi } from "./lib/bunny-api.ts";
import { waitUntilServing } from "./lib/check.ts";
import { loadConfig } from "./lib/config.ts";
import { branchName, pullZoneUrl, releaseName } from "./lib/names.ts";
import { createRelease } from "./lib/release.ts";

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

export type DeployOptions = Options & {
  /** The full hash of the commit that was built. */
  commit: string;
  /** Plain script variables, such as values the site reads through `process.env`. */
  variables?: Record<string, string>;
  /** Where the values of the build's `astro:env` secrets come from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
};

/**
 * Deploys a build: makes the commit's release and checks it on the commit's
 * URL. Reads `bunny.config.ts`, `.bunny/build.json` and the build, and calls
 * bunny.net with `BUNNYNET_API_KEY`.
 */
export async function deploy({
  commit,
  variables = {},
  env = process.env,
  root = process.cwd(),
}: DeployOptions): Promise<{ release: string; url: string }> {
  const [config, manifest] = await Promise.all([
    loadConfig(root),
    readBuildManifest(root),
  ]);
  const secrets = secretsFor(manifest.requires?.env ?? [], env);
  const api = createBunnyApi();

  const release = await createRelease(api, {
    root,
    config,
    manifest,
    commit,
    variables,
    secrets,
  });
  await waitUntilServing(release.url, { root, manifest });

  return { release: release.name, url: release.url };
}

// Fails before anything is made when a secret the build requires has no value.
function secretsFor(
  required: { name: string; secret: boolean; optional?: boolean }[],
  env: Record<string, string | undefined>,
): Record<string, string> {
  const missing = required.filter(
    ({ name, secret, optional }) => secret && !optional && !env[name],
  );
  if (missing.length) {
    throw new Error(
      `Set the secrets the build requires: ${missing.map(({ name }) => name).join(", ")}.`,
    );
  }

  return Object.fromEntries(
    required.flatMap(({ name, secret }) => {
      const value = env[name];
      return secret && value ? [[name, value]] : [];
    }),
  );
}
