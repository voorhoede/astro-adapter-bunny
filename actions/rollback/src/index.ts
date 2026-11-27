import { getInput, info, setFailed, setOutput } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import { readEdgeRules } from "../../shared/bunny/edge-rules.ts";
import { getPullZone } from "../../shared/bunny/pull-zone.ts";
import { getScript } from "../../shared/bunny/script.ts";
import { getStorageZone } from "../../shared/bunny/storage-zone.ts";
import { createDeployment, deployedReleases, isProductionBranch } from "../../shared/github/deployments.ts";
import { branchName, branchPullZoneName, releaseName } from "../../shared/github/names.ts";
import { switchPullZone } from "../../shared/releases/switch-pull-zone.ts";

try {
  const environment = getInput("environment", { required: true });
  const branch = branchName();
  const sha = await targetCommit({ environment, branch, input: getInput("commit") });
  const name = releaseName(sha);

  const storageZone = await getStorageZone({ name });
  if (!storageZone) {
    throw new Error(`No release ${name}: it was never deployed, or a clean-up deleted it.`);
  }

  // There is no build to make edge rules from; the release's commit pull zone has those of its own build.
  const commitPullZone = await getPullZone({ name });
  if (!commitPullZone) {
    throw new Error(`Release ${name} has no commit pull zone, so its edge rules are unknown.`);
  }
  const rules = await readEdgeRules({ pullZoneId: commitPullZone.Id });
  const script = await getScript({ name });

  const url = await switchPullZone({
    name: branchPullZoneName(branch),
    sha,
    storageZoneId: storageZone.Id,
    scriptId: script?.Id,
    rules,
  });

  // The action records it itself, so the deployment has the commit that runs, not the newest on the branch.
  await createDeployment({
    environment,
    sha,
    branch,
    url,
    production: isProductionBranch(branch),
    description: "Rollback",
  });

  info(`${branch} serves ${name} again`);
  setOutput("url", url.href);
  setOutput("commit", sha);
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}

/** The full commit to go back to: the given one, or the one deployed before the current one. */
async function targetCommit({ environment, branch, input }: { environment: string; branch: string; input: string }) {
  if (input) {
    const octokit = getOctokit(getInput("github_token", { required: true }));
    const { data } = await octokit.rest.repos.getCommit({ ...context.repo, ref: input });
    return data.sha;
  }

  const [current, previous] = await deployedReleases({ environment, branch });
  if (!current || !previous) {
    throw new Error(`${branch} has no earlier deployment in ${environment} to go back to.`);
  }
  return previous.sha;
}
