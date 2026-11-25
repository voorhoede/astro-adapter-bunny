import { readBuildManifest } from "./lib/build-manifest.ts";
import { createBunnyApi } from "./lib/bunny-api.ts";
import { waitForRelease } from "./lib/check.ts";
import { loadConfig } from "./lib/config.ts";
import { branchName, liveName, pullZoneUrl, releaseName } from "./lib/names.ts";
import { findByName } from "./lib/find-by-name.ts";
import { readSite } from "./lib/history.ts";
import { type PullZone, readEdgeRules, switchPullZone } from "./lib/pull-zone.ts";
import { createRelease } from "./lib/release.ts";
import { rulesForBuild } from "./lib/build-rules.ts";

export { defineConfig } from "./lib/config.ts";
export type { BunnyConfig, StorageTier } from "./lib/config.ts";
export type { PullZoneInfo, ReleaseInfo } from "./lib/history.ts";

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
  const { rules, warnings } = await rulesForBuild(root, manifest);
  for (const warning of warnings) console.warn(warning);
  const api = createBunnyApi();
  const check = {
    commit,
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
    rules,
  });
  await waitForRelease(release.url, check);

  // Visitors of the branch get the release only after it answered on its own URL.
  const targets = [
    branchName(config.name, branch),
    ...(branch === config.productionBranch ? [liveName(config.name)] : []),
  ];
  for (const name of targets) {
    await switchPullZone(api, name, release, rules);
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

/** The site's releases, newest deploy first, with the pull zones that serve each. */
export async function releases({ root = process.cwd() }: Options = {}) {
  const { name } = await loadConfig(root);
  return (await readSite(createBunnyApi(), name)).releases;
}

/** Live and the branch pull zones, with the release each points at. */
export async function status({ root = process.cwd() }: Options = {}) {
  const { name } = await loadConfig(root);
  return (await readSite(createBunnyApi(), name)).pullZones;
}

export type RollbackOptions = Options & {
  /** The commit of a release that still exists, at least its short hash. */
  commit: string;
  /** The branch whose pull zone moves. Without one, live moves. */
  branch?: string;
};

/**
 * Points live, or a branch's pull zone, at an earlier release that still
 * exists, with the edge rules of that release's commit pull zone, and checks
 * it. Uploads nothing and moves no hostname. The next deploy of that branch
 * moves it again.
 */
export async function rollback({
  commit,
  branch,
  root = process.cwd(),
}: RollbackOptions): Promise<{ release: string; url: string }> {
  const config = await loadConfig(root);
  const api = createBunnyApi();
  const name = releaseName(config.name, commit);

  const { releases } = await readSite(api, config.name);
  const release = releases.find((candidate) => candidate.name === name);
  if (!release) {
    throw new Error(
      `No release ${name}. Releases: ${releases.map(({ name }) => name).join(", ") || "none"}.`,
    );
  }
  const commitPullZone = await findByName<PullZone>(api, "/pullzone", name);
  if (!commitPullZone) throw new Error(`Release ${name} has no pull zone.`);

  const target = branch ? branchName(config.name, branch) : liveName(config.name);
  await switchPullZone(
    api,
    target,
    { storageZoneId: release.storageZoneId, scriptId: release.scriptId },
    await readEdgeRules(api, commitPullZone.Id),
  );
  await waitForRelease(pullZoneUrl(target), {
    commit: release.commit,
    hasScript: release.scriptId !== undefined,
  });

  return { release: name, url: pullZoneUrl(target) };
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
