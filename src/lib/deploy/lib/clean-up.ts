import type { BunnyApi } from "./bunny-api.ts";
import type { ResolvedConfig } from "./config.ts";
import { findByName } from "./find-by-name.ts";
import { type ReleaseInfo, readSite } from "./history.ts";
import { branchName } from "./names.ts";
import type { PullZone } from "./pull-zone.ts";
import { removeBranch } from "./release-file.ts";
import type { StorageZone } from "./storage-zone.ts";

/**
 * Deletes the releases no branch keeps: each branch keeps its newest releases,
 * `keep.production` for the production branch and `keep.branch` for others,
 * and a release a pull zone points at always stays. A release no branch has
 * deployed, such as one from before release files listed branches, stays too.
 */
export async function pruneReleases(
  api: BunnyApi,
  config: ResolvedConfig,
): Promise<string[]> {
  const { releases } = await readSite(api, config.name);
  const kept = new Set<string>();

  const branches = new Set(releases.flatMap(({ branches }) => Object.keys(branches)));
  for (const branch of branches) {
    const keep =
      branch === config.productionBranch ? config.keep.production : config.keep.branch;
    releases
      .filter((release) => branch in release.branches)
      .sort((a, b) => b.branches[branch]!.localeCompare(a.branches[branch]!))
      .slice(0, keep)
      .forEach(({ name }) => kept.add(name));
  }

  const stale = releases.filter(
    (release) =>
      !kept.has(release.name) &&
      release.servedBy.length === 0 &&
      Object.keys(release.branches).length > 0,
  );
  return deleteReleases(api, config.name, stale);
}

/**
 * Deletes a branch's pull zone and the releases only that branch deployed. A
 * release another branch deployed too only loses this branch from its file.
 */
export async function teardownBranch(
  api: BunnyApi,
  config: ResolvedConfig,
  branch: string,
): Promise<{ pullZone?: string; releases: string[] }> {
  if (branch === config.productionBranch) {
    throw new Error(`${branch} is the production branch, which a teardown never removes.`);
  }

  const name = branchName(config.name, branch);
  const pullZone = await findByName<PullZone>(api, "/pullzone", name);
  if (pullZone) await api("DELETE", `/pullzone/${pullZone.Id}`);

  const { releases } = await readSite(api, config.name);
  const ofBranch = releases.filter((release) => branch in release.branches);
  const shared = ofBranch.filter(
    (release) => Object.keys(release.branches).length > 1,
  );
  await Promise.all(
    shared.map(async (release) => {
      const zone = await findByName<StorageZone>(api, "/storagezone", release.name);
      if (zone) await removeBranch(zone, branch);
    }),
  );

  const deleted = await deleteReleases(
    api,
    config.name,
    ofBranch.filter((release) => !shared.includes(release)),
  );
  return { ...(pullZone && { pullZone: name }), releases: deleted };
}

/**
 * Deletes each release's commit pull zone first, so nothing serves it, then
 * its script and storage zone. Right before, it asks each of live and the
 * branch pull zones which storage zone it has, one by one: a list read right
 * after a switch once still named the old storage zone.
 */
async function deleteReleases(
  api: BunnyApi,
  site: string,
  releases: ReleaseInfo[],
): Promise<string[]> {
  if (releases.length === 0) return [];

  const { pullZones } = await readSite(api, site);
  const served = new Set(
    await Promise.all(
      pullZones.map(
        async ({ id }) =>
          (await api<PullZone>("GET", `/pullzone/${id}`)).StorageZoneId,
      ),
    ),
  );
  const deleted: string[] = [];

  for (const release of releases) {
    if (served.has(release.storageZoneId)) continue;

    const commitPullZone = await findByName<PullZone>(api, "/pullzone", release.name);
    if (commitPullZone) await api("DELETE", `/pullzone/${commitPullZone.Id}`);
    if (release.scriptId) {
      await api("DELETE", `/compute/script/${release.scriptId}?deleteLinkedPullZones=false`);
    }
    await api("DELETE", `/storagezone/${release.storageZoneId}`);
    deleted.push(release.name);
  }

  return deleted;
}
