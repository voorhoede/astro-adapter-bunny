import { getBooleanInput, getInput, info, setFailed } from "@actions/core";
import { listStorageZones } from "../../shared/bunny/storage-zone.ts";
import { listDeployments } from "../../shared/github/deployments.ts";
import { siteName } from "../../shared/github/names.ts";
import { deleteRelease } from "../../shared/releases/delete-release.ts";

try {
  const minAgeHours = Number(getInput("min_age_hours"));
  if (!Number.isFinite(minAgeHours) || minAgeHours < 0) {
    throw new Error(`min_age_hours has to be a number of 0 or more, got "${getInput("min_age_hours")}".`);
  }
  const dryRun = getBooleanInput("dry_run");

  const site = siteName();
  const [zones, deployments] = await Promise.all([listStorageZones({ search: site }), listDeployments()]);

  // Every commit any deployment refers to, in every environment.
  const deployed = new Set(deployments.map((deployment) => deployment.sha.slice(0, 7)));
  // A release's storage zone is named after the site and a short hash; search also finds other names that contain the site's.
  const isRelease = new RegExp(`^${site}-([0-9a-f]{7})$`);
  const cutoff = Date.now() - minAgeHours * 60 * 60 * 1000;

  for (const zone of zones) {
    const match = isRelease.exec(zone.Name);
    if (!match || deployed.has(match[1]!)) {
      continue;
    }
    // A deploy that runs now has made its release but not yet its deployment.
    if (new Date(zone.DateModified).getTime() > cutoff) {
      continue;
    }

    if (dryRun) {
      info(`Would delete orphaned release ${zone.Name}`);
      continue;
    }

    const result = await deleteRelease({ name: zone.Name });
    if (result === "served") {
      info(`Kept orphaned release ${zone.Name}: a branch pull zone serves it`);
      continue;
    }
    info(`Deleted orphaned release ${zone.Name}`);
  }
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}
