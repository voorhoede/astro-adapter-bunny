import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { BunnyConfig } from "../../src/lib/config/config.ts";
import type { PullZoneUpdate } from "./bunny/types/pullzone.ts";

/**
 * Reads the site's `bunny.config.ts` from the working directory, when it has
 * one, and fills in what the deploy needs: the storage zone of a new release,
 * and the pull zone settings a site may choose. A setting it leaves unset is
 * not sent, so bunny.net's own value stays.
 */
export const loadConfig = async () => {
  const file = join(process.cwd(), "bunny.config.ts");
  let config: BunnyConfig = {};
  if (existsSync(file)) {
    const module = (await import(pathToFileURL(file).href)) as { default?: BunnyConfig };
    config = module.default ?? {};
  }

  return {
    storage: {
      region: config.storage?.region ?? "DE",
      tier: config.storage?.tier === "standard" ? (0 as const) : (1 as const),
      replicationRegions: config.storage?.replicationRegions ?? [],
    },
    pullZone: pullZoneSettings(config.pullZone ?? {}),
  };
};

const pullZoneSettings = ({ regions, minimumTls, anonymizeIps }: NonNullable<BunnyConfig["pullZone"]>) => {
  const settings: PullZoneUpdate = {};

  if (regions) {
    settings.EnableGeoZoneEU = regions.includes("EU");
    settings.EnableGeoZoneUS = regions.includes("US");
    settings.EnableGeoZoneASIA = regions.includes("ASIA");
    settings.EnableGeoZoneSA = regions.includes("SA");
    settings.EnableGeoZoneAF = regions.includes("AF");
  }

  if (minimumTls) {
    settings.EnableTLS1 = minimumTls === "1.0";
    settings.EnableTLS1_1 = minimumTls !== "1.2";
  }

  if (anonymizeIps !== undefined) {
    settings.LoggingIPAnonymizationEnabled = anonymizeIps;
  }

  return settings;
};
