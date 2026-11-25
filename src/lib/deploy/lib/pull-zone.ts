import type { BunnyApi } from "./bunny-api.ts";
import { type EdgeRule, RULE_PREFIX } from "./edge-rules.ts";
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
  rules: EdgeRule[],
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
  await applyEdgeRules(api, pullZone.Id, rules);

  return pullZone;
}

/**
 * Makes the tool's rules on a pull zone match `rules`: a rule with the same
 * description is updated in place, so a header is never missing in between,
 * and the tool's rules that are no longer needed are deleted. Rules without
 * the tool's prefix belong to the site owner and stay.
 */
async function applyEdgeRules(
  api: BunnyApi,
  pullZoneId: number,
  rules: EdgeRule[],
): Promise<void> {
  const { EdgeRules: current } = await api<{
    EdgeRules: { Guid: string; Description: string }[];
  }>("GET", `/pullzone/${pullZoneId}`);
  const ours = current.filter(({ Description }) =>
    Description.startsWith(RULE_PREFIX),
  );

  for (const rule of rules) {
    const existing = ours.find(({ Description }) => Description === rule.Description);
    await api("POST", `/pullzone/${pullZoneId}/edgerules/addOrUpdate`, {
      ...rule,
      ...(existing && { Guid: existing.Guid }),
    });
  }

  const wanted = new Set(rules.map(({ Description }) => Description));
  for (const { Guid, Description } of ours) {
    if (!wanted.has(Description)) {
      await api("DELETE", `/pullzone/${pullZoneId}/edgerules/${Guid}`);
    }
  }
}

/**
 * Points a branch's pull zone or live at a release, making it on its first
 * deploy. Origin type, storage zone and script change in one call, then the
 * release's edge rules, and a purge follows: without the origin type or the
 * purge, the edge kept the old storage zone for minutes.
 */
export async function switchPullZone(
  api: BunnyApi,
  name: string,
  release: { storageZoneId: number; scriptId?: number },
  rules: EdgeRule[],
): Promise<PullZone> {
  const pullZone = await findOrCreatePullZone(api, name, release, rules);
  await api("POST", `/pullzone/${pullZone.Id}/purgeCache`);
  return pullZone;
}
