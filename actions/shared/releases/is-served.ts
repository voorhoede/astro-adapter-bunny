import { getPullZoneById, listPullZones } from "../bunny/pull-zone.ts";
import { isSiteResource, releaseSha, siteName } from "../github/names.ts";

/**
 * Whether a branch pull zone of the site points at this storage zone. Commit
 * pull zones do not count. Each pull zone is asked on its own: a list read
 * right after a switch once still named the old storage zone.
 */
export const isServed = async ({ storageZoneId }: { storageZoneId: number }) => {
  const pullZones = await listPullZones({ search: siteName() });
  for (const pullZone of pullZones) {
    if (!isSiteResource(pullZone.Name)) {
      continue;
    }
    // A commit pull zone always serves its own release.
    if (releaseSha(pullZone.Name)) {
      continue;
    }
    const current = await getPullZoneById({ id: pullZone.Id });
    if (current.StorageZoneId === storageZoneId) {
      return true;
    }
  }
  return false;
};
