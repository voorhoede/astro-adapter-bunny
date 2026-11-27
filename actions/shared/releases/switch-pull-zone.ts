import { info, warning } from "@actions/core";
import { readEdgeRules } from "../bunny/edge-rules.ts";
import { configurePullZone, createPullZone, getPullZone, purgePullZone } from "../bunny/pull-zone.ts";
import type { EdgeRule } from "../bunny/types/edgerule.ts";
import type { PullZoneUpdate } from "../bunny/types/pullzone.ts";
import { pullZoneUrl } from "../github/names.ts";
import { waitForRelease } from "./wait-for-release.ts";

/**
 * Points a branch pull zone at a release, making it on the branch's first
 * deploy, then purges it and waits until it answers with the release. When it
 * does not, it points the pull zone back at the release it served before and
 * fails, so a branch never stays on a release that was not confirmed.
 */
export const switchPullZone = async ({
  name,
  sha,
  storageZoneId,
  scriptId,
  rules,
  settings,
}: {
  name: string;
  sha: string;
  storageZoneId: number;
  scriptId?: number;
  rules: EdgeRule[];
  settings: PullZoneUpdate;
}) => {
  let pullZone = await getPullZone({ name });
  const created = !pullZone;
  if (!pullZone) {
    pullZone = await createPullZone({ name, storageZoneId });
  }

  // What the pull zone serves now, to go back to.
  let previous: { storageZoneId: number; scriptId?: number; rules: EdgeRule[] } | undefined;
  if (!created && pullZone.StorageZoneId !== storageZoneId) {
    previous = {
      storageZoneId: pullZone.StorageZoneId,
      scriptId: pullZone.MiddlewareScriptId ?? undefined,
      rules: await readEdgeRules({ pullZoneId: pullZone.Id }),
    };
  }

  const url = pullZoneUrl(name);
  await configurePullZone({ id: pullZone.Id, name, storageZoneId, scriptId, rules, settings });
  await purgePullZone({ id: pullZone.Id });

  try {
    await waitForRelease({ url, sha });
  } catch (error) {
    if (!previous) {
      throw error;
    }
    warning(`${url.href} did not answer with the new release, so it goes back to the one it served before.`);
    await configurePullZone({ id: pullZone.Id, name, ...previous, settings });
    await purgePullZone({ id: pullZone.Id });
    info(`${name} serves its previous release again`);
    throw error;
  }

  return url;
};
