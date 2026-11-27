import { getInput, info, setFailed } from "@actions/core";
import { deployedReleases } from "../../shared/github/deployments.ts";
import { branchName } from "../../shared/github/names.ts";
import { deleteReleases } from "../../shared/releases/delete-releases.ts";

try {
  const environment = getInput("environment", { required: true });
  const releasesToKeep = Number(getInput("releases_to_keep"));
  if (!Number.isInteger(releasesToKeep) || releasesToKeep < 0) {
    throw new Error(`releases_to_keep has to be a whole number of 0 or more, got "${getInput("releases_to_keep")}".`);
  }

  // Newest first. Each build is a release of its own, also a rebuild of the same commit.
  const releases = await deployedReleases({ environment, branch: branchName() });
  const older = releases.slice(releasesToKeep);

  const deleted = await deleteReleases({ releases: older });
  info(`Kept ${releases.length - older.length} releases, deleted ${deleted.length}`);
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}
