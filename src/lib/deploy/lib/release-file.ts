import { getFile, putFile, type StorageZone } from "./storage-zone.ts";

/**
 * Every release's storage zone holds this file at its root, outside the site's
 * base, so the tool can read it without the build and recognize the release on
 * any pull zone that serves it.
 */
export const RELEASE_FILE = ".bunny/release.json";

export type ReleaseFile = {
  commit: string;
  /** Each branch that deployed this commit, with the time of its newest deploy. */
  branches: Record<string, string>;
};

export async function readReleaseFile(
  zone: StorageZone,
): Promise<ReleaseFile | undefined> {
  const text = await getFile(zone, RELEASE_FILE);
  return text ? (JSON.parse(text) as ReleaseFile) : undefined;
}

/** Adds the branch to the file, keeping the branches that deployed the same commit before. */
export async function writeReleaseFile(
  zone: StorageZone,
  { commit, branch }: { commit: string; branch: string },
): Promise<void> {
  const current = await readReleaseFile(zone);
  const file: ReleaseFile = {
    commit,
    branches: {
      ...(current?.commit === commit ? current.branches : {}),
      [branch]: new Date().toISOString(),
    },
  };
  await putFile(zone, RELEASE_FILE, JSON.stringify(file));
}

/** Takes a branch out of the file, for a teardown of one branch of a release several branches deployed. */
export async function removeBranch(
  zone: StorageZone,
  branch: string,
): Promise<void> {
  const current = await readReleaseFile(zone);
  if (!current || !(branch in current.branches)) return;

  const { [branch]: _, ...branches } = current.branches;
  await putFile(zone, RELEASE_FILE, JSON.stringify({ ...current, branches }));
}
