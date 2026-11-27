import { getPullZoneById, listPullZones } from "../bunny/pull-zone.ts";
import { isSiteResource, isReleaseName, siteName } from "../github/names.ts";

/**
 * Whether a branch pull zone of the site points at this storage zone. A
 * release's own pull zone does not count. Each pull zone is asked on its own: a list read
 * right after a switch once still named the old storage zone.
 */
export const isServed = async ({ storageZoneId }: { storageZoneId: number }) => {
  const pullZones = await listPullZones({ search: siteName() });
  for (const pullZone of pullZones) {
    if (!isSiteResource(pullZone.Name)) {
      continue;
    }
    // A release's own pull zone always serves it.
    if (isReleaseName(pullZone.Name)) {
      continue;
    }
    const current = await getPullZoneById({ id: pullZone.Id });
    if (current.StorageZoneId === storageZoneId) {
      return true;
    }
  }
  return false;
};
