import { readdir, readFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import { uploadFile } from "../../shared/bunny/storage-zone.ts";
import type { StorageZoneResponse } from "../../shared/bunny/types/storagezone.ts";

// These two become edge rules and are not for visitors.
const SKIP = ["_redirects", "_headers"];

/** Lists a directory's files with forward slashes, which a URL needs on every platform. */
export const listFiles = async (dir: string) => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"));
};

/** Uploads the build's files under the site's base, eight at a time. */
export const uploadFiles = async ({
  storageZone,
  dir,
  base,
}: {
  storageZone: StorageZoneResponse;
  dir: string;
  base: string;
}) => {
  const files = (await listFiles(dir)).filter((path) => !SKIP.includes(path));

  // One by one is slow, all at once can overload the storage API.
  for (let i = 0; i < files.length; i += 8) {
    const batch = files.slice(i, i + 8);
    await Promise.all(
      batch.map(async (path) => {
        const body = new Uint8Array(await readFile(join(dir, path)));
        await uploadFile({ storageZone, path: posix.join(base, path), body });
      }),
    );
  }

  return files;
};
