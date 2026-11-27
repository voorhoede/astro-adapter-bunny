import { getInput, info, setFailed } from "@actions/core";
import { deletePullZone, getPullZone } from "../../shared/bunny/pull-zone.ts";
import { deployedReleases, isProductionBranch } from "../../shared/github/deployments.ts";
import { branchName, branchPullZoneName } from "../../shared/github/names.ts";
import { deleteReleases } from "../../shared/releases/delete-releases.ts";

try {
  const environment = getInput("environment", { required: true });
  const branch = branchName();
  if (isProductionBranch(branch)) {
    throw new Error(`${branch} is the production branch, which a teardown never removes.`);
  }

  // The branch's pull zone first, so nothing serves its releases any more.
  const pullZone = await getPullZone({ name: branchPullZoneName(branch) });
  if (pullZone) {
    await deletePullZone({ id: pullZone.Id });
    info(`Deleted pull zone ${pullZone.Name}`);
  }

  // A teardown is a clean-up that keeps nothing.
  const releases = await deployedReleases({ environment, branch });
  const deleted = await deleteReleases({ releases });
  info(`Deleted ${deleted.length} releases`);
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}
