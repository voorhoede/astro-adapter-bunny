import { posix } from "node:path";
import { request, requestList } from "./request.ts";
import type { EdgeRule } from "./types/edgerule.ts";
import type { ForceSSL, PullZone, PullZoneResponse, PullZoneUpdate } from "./types/pullzone.ts";
import { applyEdgeRules } from "./edge-rules.ts";

export const getPullZone = async ({ name }: { name: string }) => {
  const pullZones = await listPullZones({ search: name });
  return pullZones.find((pullZone) => pullZone.Name === name);
};

export const getPullZoneById = ({ id }: { id: number }) =>
  request<PullZoneResponse>("GET", posix.join("pullzone", String(id)));

export const listPullZones = ({ search }: { search: string }) =>
  requestList<PullZoneResponse>("pullzone", { search });

// bunny.net refuses a pull zone without an origin, so it is made with the release's storage zone.
export const createPullZone = ({ name, storageZoneId }: { name: string; storageZoneId: number }) =>
  request<PullZoneResponse>("POST", "pullzone", {
    body: { Name: name, OriginType: 2, StorageZoneId: storageZoneId } satisfies PullZone,
  });

export const deletePullZone = ({ id }: { id: number }) =>
  request("DELETE", posix.join("pullzone", String(id)));

// Without a purge after a switch, the edge kept the old storage zone for minutes.
export const purgePullZone = ({ id }: { id: number }) =>
  request("POST", posix.join("pullzone", String(id), "purgeCache"));

/**
 * Points a pull zone at a release, with the settings of docs/deploy.md and
 * the release's edge rules. Running it again is safe, so it also repairs a
 * pull zone an earlier run left halfway.
 */
export const configurePullZone = async ({
  id,
  name,
  storageZoneId,
  scriptId,
  rules,
}: {
  id: number;
  name: string;
  storageZoneId: number;
  scriptId?: number;
  rules: EdgeRule[];
}) => {
  // A site with a script sets Cache-Control itself, so the pull zone respects it.
  let cache: PullZoneUpdate = { CacheControlMaxAgeOverride: -1 };
  if (!scriptId) {
    // A static site has no script: cache at the edge for 30 days, browsers revalidate.
    cache = { CacheControlMaxAgeOverride: 2592000, CacheControlPublicMaxAgeOverride: 0 };
  }

  // Origin type, storage zone and script in one call: without OriginType, bunny.net kept the old storage zone.
  await request("POST", posix.join("pullzone", String(id)), {
    body: {
      OriginType: 2,
      StorageZoneId: storageZoneId,
      MiddlewareScriptId: scriptId ?? null,
      EnableSmartCache: false,
      IgnoreQueryStrings: false,
      DisableCookies: false,
      EnableCacheSlice: false,
      ...cache,
    } satisfies PullZoneUpdate,
  });

  const hostname = new URL("https://b-cdn.net");
  hostname.hostname = `${name}.b-cdn.net`;
  await request("POST", posix.join("pullzone", String(id), "setForceSSL"), {
    body: { Hostname: hostname.hostname, ForceSSL: true } satisfies ForceSSL,
  });

  await applyEdgeRules({ pullZoneId: id, rules });
};
