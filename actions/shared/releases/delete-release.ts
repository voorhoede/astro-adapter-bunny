import { deletePullZone, getPullZone } from "../bunny/pull-zone.ts";
import { deleteScript, getScript } from "../bunny/script.ts";
import { deleteStorageZone, getStorageZone } from "../bunny/storage-zone.ts";
import { isServed } from "./is-served.ts";

/**
 * Deletes a release: its own pull zone first, so nothing serves it, then
 * its script and storage zone. Answers "gone" when it no longer exists, also
 * when an earlier run deleted it, and "served" when a branch pull zone still
 * points at it, which keeps it.
 */
export const deleteRelease = async ({ name }: { name: string }): Promise<"gone" | "served"> => {
  const storageZone = await getStorageZone({ name });
  if (storageZone && (await isServed({ storageZoneId: storageZone.Id }))) {
    return "served";
  }

  const pullZone = await getPullZone({ name });
  if (pullZone) {
    await deletePullZone({ id: pullZone.Id });
  }

  const script = await getScript({ name });
  if (script) {
    await deleteScript({ id: script.Id });
  }

  if (storageZone) {
    await deleteStorageZone({ id: storageZone.Id });
  }

  return "gone";
};
