import { getPullZoneById, listPullZones } from "../bunny/pull-zone.ts";
import { siteName } from "../github/names.ts";

/**
 * Whether a branch pull zone of the site points at this storage zone. Commit
 * pull zones do not count. Each pull zone is asked on its own: a list read
 * right after a switch once still named the old storage zone.
 */
export const isServed = async ({ storageZoneId }: { storageZoneId: number }) => {
  const site = siteName();
  const isCommitPullZone = new RegExp(`^${site}-[0-9a-f]{7}$`);

  const pullZones = await listPullZones({ search: site });
  for (const pullZone of pullZones) {
    if (pullZone.Name !== site && !pullZone.Name.startsWith(`${site}-`)) {
      continue;
    }
    if (isCommitPullZone.test(pullZone.Name)) {
      continue;
    }
    const current = await getPullZoneById({ id: pullZone.Id });
    if (current.StorageZoneId === storageZoneId) {
      return true;
    }
  }
  return false;
};
