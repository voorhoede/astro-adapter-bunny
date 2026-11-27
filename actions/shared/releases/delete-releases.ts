import { info } from "@actions/core";
import { deleteDeployment, type Deployment } from "../github/deployments.ts";
import { deleteRelease } from "./delete-release.ts";

/**
 * Deletes these releases one at a time, and the deployments
 * that refer to a release once it is gone. A release a branch pull zone
 * still serves stays, and so do its deployments.
 */
export const deleteReleases = async ({ releases }: { releases: { release: string; deployments: Deployment[] }[] }) => {
  const deleted: string[] = [];

  for (const { release: name, deployments } of releases) {
    const result = await deleteRelease({ name });
    if (result === "served") {
      info(`Kept release ${name}: a branch pull zone serves it`);
      continue;
    }

    for (const deployment of deployments) {
      await deleteDeployment({ id: deployment.id });
    }
    info(`Deleted release ${name} and ${deployments.length} deployments`);
    deleted.push(name);
  }

  return deleted;
};
