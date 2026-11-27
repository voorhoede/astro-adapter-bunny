import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** What a project may set in `bunny.config.ts`: how its resources on bunny.net are made. */
export type BunnyConfig = {
  storage?: {
    /** Main region. Applies from the next release, since a zone's region cannot change. */
    region?: string;
    /** 0 Standard, 1 Edge (SSD). */
    tier?: 0 | 1;
    replicationRegions?: string[];
  };
};

// Merged per level, so setting one field in a block keeps that block's other defaults.
export const loadConfig = async () => {
  const file = join(process.cwd(), "bunny.config.ts");
  let config: BunnyConfig = {};
  if (existsSync(file)) {
    config = ((await import(pathToFileURL(file).href)) as { default?: BunnyConfig }).default ?? {};
  }

  return {
    storage: {
      region: config.storage?.region ?? "DE",
      tier: config.storage?.tier ?? 1,
      replicationRegions: config.storage?.replicationRegions ?? [],
    },
  };
};
