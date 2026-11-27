import { configurePullZone, createPullZone, getPullZone, purgePullZone } from "../bunny/pull-zone.ts";
import type { EdgeRule } from "../bunny/types/edgerule.ts";
import { pullZoneUrl } from "../github/names.ts";
import { waitForRelease } from "./wait-for-release.ts";

/**
 * Points a branch pull zone at a release, making it on the branch's first
 * deploy, then purges it and waits until it answers with the release.
 */
export const switchPullZone = async ({
  name,
  sha,
  storageZoneId,
  scriptId,
  rules,
}: {
  name: string;
  sha: string;
  storageZoneId: number;
  scriptId?: number;
  rules: EdgeRule[];
}) => {
  let pullZone = await getPullZone({ name });
  if (!pullZone) {
    pullZone = await createPullZone({ name, storageZoneId });
  }

  await configurePullZone({ id: pullZone.Id, name, storageZoneId, scriptId, rules });
  await purgePullZone({ id: pullZone.Id });

  const url = pullZoneUrl(name);
  await waitForRelease({ url, sha, hasScript: scriptId !== undefined });
  return url;
};
