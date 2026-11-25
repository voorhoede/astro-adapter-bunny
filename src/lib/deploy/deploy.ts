import { readBuildManifest } from "./lib/build-manifest.ts";
import { createBunnyApi } from "./lib/bunny-api.ts";
import { waitForRelease } from "./lib/check.ts";
import { loadConfig } from "./lib/config.ts";
import { branchName, liveName, pullZoneUrl, releaseName } from "./lib/names.ts";
import { switchPullZone } from "./lib/pull-zone.ts";
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
  /** The branch the commit was built from. Its pull zone moves to the release. */
  branch: string;
  /** Plain script variables, such as values the site reads through `process.env`. */
  variables?: Record<string, string>;
  /** Where the values of the build's `astro:env` secrets come from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
};

export type DeployResult = {
  release: string;
  /** The commit's URL, which keeps answering with this release. */
  url: string;
  /** The branch's URL, which now answers with this release. */
  branchUrl: string;
  /** Live's `b-cdn.net` URL, when the branch is the production branch. */
  liveUrl?: string;
};

/**
 * Deploys a build: makes the commit's release and checks it on the commit's
 * URL, then moves the branch's pull zone to it, and live too for the
 * production branch, checking each. Reads `bunny.config.ts`,
 * `.bunny/build.json` and the build, and calls bunny.net with
 * `BUNNYNET_API_KEY`.
 */
export async function deploy({
  commit,
  branch,
  variables = {},
  env = process.env,
  root = process.cwd(),
}: DeployOptions): Promise<DeployResult> {
  const [config, manifest] = await Promise.all([
    loadConfig(root),
    readBuildManifest(root),
  ]);
  const secrets = secretsFor(manifest.requires?.env ?? [], env);
  const api = createBunnyApi();
  const check = {
    commit,
    base: manifest.astroAdapterBunny.base,
    hasScript: manifest.script !== undefined,
  };

  const release = await createRelease(api, {
    root,
    config,
    manifest,
    commit,
    branch,
    variables,
    secrets,
  });
  await waitForRelease(release.url, check);

  // Visitors of the branch get the release only after it answered on its own URL.
  const targets = [
    branchName(config.name, branch),
    ...(branch === config.productionBranch ? [liveName(config.name)] : []),
  ];
  for (const name of targets) {
    await switchPullZone(api, name, release);
    await waitForRelease(pullZoneUrl(name), check);
  }

  const [branchTarget, liveTarget] = targets as [string, string?];
  return {
    release: release.name,
    url: release.url,
    branchUrl: pullZoneUrl(branchTarget),
    ...(liveTarget && { liveUrl: pullZoneUrl(liveTarget) }),
  };
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
