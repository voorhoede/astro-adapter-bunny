import type { BunnyApi } from "./bunny-api.ts";
import { findByName } from "./find-by-name.ts";

export type PullZone = {
  Id: number;
  Name: string;
  StorageZoneId: number;
  MiddlewareScriptId: number | null;
};

// bunny.net's origin type for a storage zone.
const STORAGE_ORIGIN = 2;

/** The pull zone settings of docs/deploy.md, "Pull zone settings" and "Static sites". */
function settings(hasScript: boolean) {
  return {
    EnableSmartCache: false,
    IgnoreQueryStrings: false,
    DisableCookies: false,
    EnableCacheSlice: false,
    ...(hasScript
      ? { CacheControlMaxAgeOverride: -1 }
      : {
          CacheControlMaxAgeOverride: 2592000,
          CacheControlPublicMaxAgeOverride: 0,
        }),
  };
}

/** Makes a pull zone that serves a release, or finds the one an earlier run made. */
export async function findOrCreatePullZone(
  api: BunnyApi,
  name: string,
  release: { storageZoneId: number; scriptId?: number },
): Promise<PullZone> {
  const existing = await findByName<PullZone>(api, "/pullzone", name);
  const pullZone =
    existing ??
    (await api<PullZone>("POST", "/pullzone", {
      Name: name,
      OriginType: STORAGE_ORIGIN,
      StorageZoneId: release.storageZoneId,
      ...settings(release.scriptId !== undefined),
    }));

  await api("POST", `/pullzone/${pullZone.Id}`, {
    OriginType: STORAGE_ORIGIN,
    StorageZoneId: release.storageZoneId,
    MiddlewareScriptId: release.scriptId ?? null,
    ...settings(release.scriptId !== undefined),
  });
  await api("POST", `/pullzone/${pullZone.Id}/setForceSSL`, {
    Hostname: `${name}.b-cdn.net`,
    ForceSSL: true,
  });

  return pullZone;
}

/**
 * Points a branch's pull zone or live at a release, making it on its first
 * deploy. Origin type, storage zone and script change in one call and a purge
 * follows: without either, the edge kept the old storage zone for minutes.
 */
export async function switchPullZone(
  api: BunnyApi,
  name: string,
  release: { storageZoneId: number; scriptId?: number },
): Promise<PullZone> {
  const pullZone = await findOrCreatePullZone(api, name, release);
  await api("POST", `/pullzone/${pullZone.Id}/purgeCache`);
  return pullZone;
}
