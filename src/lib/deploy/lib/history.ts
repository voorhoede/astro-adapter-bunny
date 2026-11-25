import type { BunnyApi } from "./bunny-api.ts";
import { liveName, pullZoneUrl } from "./names.ts";
import type { PullZone } from "./pull-zone.ts";
import { type ReleaseFile, readReleaseFile } from "./release-file.ts";
import type { StorageZone } from "./storage-zone.ts";

export type ReleaseInfo = {
  /** The name of its storage zone, script and commit pull zone. */
  name: string;
  commit: string;
  /** The commit's URL. */
  url: string;
  /** Each branch that deployed this commit, with the time of its newest deploy. */
  branches: ReleaseFile["branches"];
  /** The branch pull zones and live that point at this release now. */
  servedBy: string[];
  storageZoneId: number;
  scriptId?: number;
};

export type PullZoneInfo = {
  name: string;
  url: string;
  kind: "live" | "branch";
  /** The release it points at, or undefined when its storage zone is no release of this site. */
  release?: string;
};

/**
 * Reads the site's releases and the pull zones that move between them from
 * bunny.net alone: a release is a storage zone named after the site and a
 * short hash, with its release file; the other pull zones of the site are
 * live and the branch pull zones.
 */
export async function readSite(
  api: BunnyApi,
  site: string,
): Promise<{ releases: ReleaseInfo[]; pullZones: PullZoneInfo[] }> {
  const isRelease = new RegExp(`^${escape(site)}-[0-9a-f]{7}$`);
  const isSite = new RegExp(`^${escape(site)}(-|$)`);

  const [zones, allPullZones] = await Promise.all([
    listAll<StorageZone>(api, `/storagezone?search=${encodeURIComponent(site)}`),
    listAll<PullZone>(api, `/pullzone?search=${encodeURIComponent(site)}`),
  ]);
  const releaseZones = zones.filter(({ Name }) => isRelease.test(Name));
  const byZoneId = new Map(releaseZones.map((zone) => [zone.Id, zone.Name]));

  // A commit pull zone has the name of its release; the rest of the site's pull zones move.
  const pullZones: PullZoneInfo[] = allPullZones
    .filter(({ Name }) => isSite.test(Name) && !isRelease.test(Name))
    .map(({ Name, StorageZoneId }) => ({
      name: Name,
      url: pullZoneUrl(Name),
      kind: Name === liveName(site) ? "live" : "branch",
      ...(byZoneId.has(StorageZoneId) && { release: byZoneId.get(StorageZoneId) }),
    }));
  const scripts = new Map(
    allPullZones
      .filter(({ Name }) => isRelease.test(Name))
      .map(({ Name, MiddlewareScriptId }) => [Name, MiddlewareScriptId]),
  );

  const releases = await Promise.all(
    releaseZones.map(async (zone): Promise<ReleaseInfo> => {
      const file = await readReleaseFile(zone);
      const scriptId = scripts.get(zone.Name);
      return {
        name: zone.Name,
        commit: file?.commit ?? zone.Name.slice(site.length + 1),
        url: pullZoneUrl(zone.Name),
        branches: file?.branches ?? {},
        servedBy: pullZones
          .filter(({ release }) => release === zone.Name)
          .map(({ name }) => name),
        storageZoneId: zone.Id,
        ...(scriptId && { scriptId }),
      };
    }),
  );

  return {
    releases: releases.sort((a, b) => newest(b).localeCompare(newest(a))),
    pullZones,
  };
}

function newest({ branches }: ReleaseInfo): string {
  return Object.values(branches).sort().at(-1) ?? "";
}

async function listAll<T>(api: BunnyApi, path: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const result = await api<T[] | { Items: T[]; HasMoreItems: boolean }>(
      "GET",
      `${path}&page=${page}&perPage=1000`,
    );
    if (Array.isArray(result)) return result;
    items.push(...result.Items);
    if (!result.HasMoreItems) return items;
  }
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
