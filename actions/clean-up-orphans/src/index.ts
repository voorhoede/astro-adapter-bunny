import { getBooleanInput, getInput, info, setFailed } from "@actions/core";
import { listStorageZones } from "../../shared/bunny/storage-zone.ts";
import { listDeployments } from "../../shared/github/deployments.ts";
import { isReleaseName, siteName } from "../../shared/github/names.ts";
import { deleteRelease } from "../../shared/releases/delete-release.ts";

try {
  const minAgeHours = Number(getInput("min_age_hours"));
  if (!Number.isFinite(minAgeHours) || minAgeHours < 0) {
    throw new Error(`min_age_hours has to be a number of 0 or more, got "${getInput("min_age_hours")}".`);
  }
  const dryRun = getBooleanInput("dry_run");

  const [zones, deployments] = await Promise.all([listStorageZones({ search: siteName() }), listDeployments()]);

  // Every release any deployment refers to, in every environment.
  const deployed = new Set(deployments.map((deployment) => deployment.release));
  const cutoff = Date.now() - minAgeHours * 60 * 60 * 1000;

  for (const zone of zones) {
    // Search also finds other names that contain the site's; only a release of this site counts.
    if (!isReleaseName(zone.Name) || deployed.has(zone.Name)) {
      continue;
    }
    // A deploy that runs now has made its release but not yet its deployment.
    // bunny.net gives the time in UTC without saying so; read bare, it would be local time, and off by hours.
    const modified = new Date(/Z|[+-]\d\d:\d\d$/.test(zone.DateModified) ? zone.DateModified : `${zone.DateModified}Z`);
    // A date that does not parse keeps the release: deleting is the step that cannot be undone.
    if (Number.isNaN(modified.getTime()) || modified.getTime() > cutoff) {
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
