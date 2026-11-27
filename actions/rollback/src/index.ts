import { getInput, info, setFailed, setOutput } from "@actions/core";
import { readEdgeRules } from "../../shared/bunny/edge-rules.ts";
import { getPullZone } from "../../shared/bunny/pull-zone.ts";
import { getScript } from "../../shared/bunny/script.ts";
import { getStorageZone } from "../../shared/bunny/storage-zone.ts";
import { createDeployment, deployedReleases, isProductionDeployment } from "../../shared/github/deployments.ts";
import { branchName, branchPullZoneName, siteName } from "../../shared/github/names.ts";
import { switchPullZone } from "../../shared/releases/switch-pull-zone.ts";
import { loadConfig } from "../../shared/config.ts";

try {
  // The site's folder, with its bunny.config.ts; without one, the pull zone keeps its settings.
  process.chdir(getInput("working_directory") || ".");

  const environment = getInput("environment", { required: true });
  const branch = branchName();
  const { release: name, sha } = await targetRelease({
    environment,
    branch,
    release: getInput("release"),
    commit: getInput("commit"),
  });

  const storageZone = await getStorageZone({ name });
  if (!storageZone) {
    throw new Error(`No release ${name}: it was never deployed, or a clean-up deleted it.`);
  }

  // There is no build to make edge rules from; the release's own pull zone has those of its build.
  const releasePullZone = await getPullZone({ name });
  if (!releasePullZone) {
    throw new Error(`Release ${name} has no pull zone of its own, so its edge rules are unknown.`);
  }
  const rules = await readEdgeRules({ pullZoneId: releasePullZone.Id });
  const script = await getScript({ name });
  const config = await loadConfig();

  const url = await switchPullZone({
    name: branchPullZoneName(branch),
    release: name,
    storageZoneId: storageZone.Id,
    scriptId: script?.Id,
    rules,
    settings: config.pullZone,
  });

  // The action records it itself, so the deployment has the release that runs, not the newest on the branch.
  await createDeployment({
    environment,
    release: name,
    sha,
    branch,
    url,
    production: isProductionDeployment(branch),
    description: "Rollback",
  });

  info(`${branch} serves ${name} again`);
  setOutput("url", url.href);
  setOutput("release", name);
  setOutput("commit", sha);
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}

/**
 * The release to go back to, from the branch's deployments in the
 * environment: the one named, the newest of the given commit, or else the one
 * deployed before the current one.
 */
async function targetRelease({
  environment,
  branch,
  release,
  commit,
}: {
  environment: string;
  branch: string;
  release: string;
  commit: string;
}) {
  const releases = await deployedReleases({ environment, branch });

  if (release) {
    // The whole name, or the commit and build without the site, such as c50ccf3-412.
    const found = releases.find((entry) => entry.release === release || entry.release === `${release}-${siteName()}`);
    if (!found) {
      throw new Error(`${branch} has no deployment of release ${release} in ${environment}.`);
    }
    return found;
  }

  if (commit) {
    // Newest first, so a commit built more than once goes back to its latest build.
    const found = releases.find((entry) => entry.sha.startsWith(commit.toLowerCase()));
    if (!found) {
      throw new Error(`${branch} has no deployment of commit ${commit} in ${environment}.`);
    }
    return found;
  }

  const [current, previous] = releases;
  if (!current || !previous) {
    throw new Error(`${branch} has no earlier deployment in ${environment} to go back to.`);
  }
  return previous;
}
