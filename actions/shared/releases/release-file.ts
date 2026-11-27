import type { StorageZoneResponse } from "../bunny/types/storagezone.ts";
import { uploadFile } from "../bunny/storage-zone.ts";

/**
 * Every release's storage zone holds this file at its root, outside the site's
 * base, with the commit it was built from. A check reads it through a pull
 * zone to see which release answers.
 */
export const RELEASE_FILE = ".bunny/release.json";

export const uploadReleaseFile = async ({ storageZone, sha }: { storageZone: StorageZoneResponse; sha: string }) => {
  const body = new TextEncoder().encode(JSON.stringify({ commit: sha, deployedAt: new Date().toISOString() }));
  await uploadFile({ storageZone, path: RELEASE_FILE, body });
};
