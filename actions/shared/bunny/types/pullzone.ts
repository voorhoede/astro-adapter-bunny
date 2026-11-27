import type { EdgeRuleResponse } from "./edgerule.ts";

// POST /pullzone
export type PullZone = {
  Name: string;
} & PullZoneUpdate;

// POST /pullzone/{id}. Origin type, storage zone and script go in one call, or bunny.net keeps the old storage zone.
export type PullZoneUpdate = {
  /** 2 Storage Zone. */
  OriginType?: 2;
  StorageZoneId?: number;
  /** Null for a static site, which has no script. */
  MiddlewareScriptId?: number | null;

  // Settings from docs/deploy.md
  EnableSmartCache?: boolean;
  /** -1 respects the origin's Cache-Control. */
  CacheControlMaxAgeOverride?: number;
  CacheControlPublicMaxAgeOverride?: number;
  IgnoreQueryStrings?: boolean;
  DisableCookies?: boolean;
  EnableCacheSlice?: boolean;
};

// POST /pullzone/{id}/setForceSSL
export type ForceSSL = { Hostname: string; ForceSSL: boolean };

// What GET, POST and the list of /pullzone answer.
export type PullZoneResponse = {
  Id: number;
  Name: string;
  StorageZoneId: number;
  MiddlewareScriptId: number | null;
  Hostnames: { Value: string; ForceSSL: boolean }[];
  EdgeRules: EdgeRuleResponse[];
};
