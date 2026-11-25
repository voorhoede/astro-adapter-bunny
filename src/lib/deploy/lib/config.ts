import { access } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type StorageTier = "edge" | "standard";

export type BunnyConfig = {
  /** Names every zone, script and pull zone of the site. Lowercase letters, digits and hyphens; unique on bunny.net. */
  name: string;
  storage?: {
    /** The main storage region, such as `DE`. Cannot change on an existing zone, so it applies from the next release. */
    region?: string;
    /** Cannot change on an existing zone, so it applies from the next release. */
    tier?: StorageTier;
    /** Regions storage replicates to, such as `["SE", "NY"]`. A region cannot be removed from an existing zone. */
    replicationRegions?: string[];
  };
  /** The branch whose newest release goes live. Defaults to `main`. */
  productionBranch?: string;
  /** How many releases each branch keeps, besides the one its pull zone points at. */
  keep?: { production?: number; branch?: number };
};

export type ResolvedConfig = {
  name: string;
  storage: { region: string; tier: StorageTier; replicationRegions: string[] };
  productionBranch: string;
  keep: { production: number; branch: number };
};

export const CONFIG_FILE = "bunny.config.ts";

/** Types a project's `bunny.config.ts`. */
export function defineConfig(config: BunnyConfig): BunnyConfig {
  return config;
}

/** Reads `bunny.config.ts` from the project root and fills in the defaults. */
export async function loadConfig(root: string): Promise<ResolvedConfig> {
  const file = join(root, CONFIG_FILE);

  try {
    await access(file);
  } catch {
    throw new Error(`No ${CONFIG_FILE} in ${root}.`);
  }

  const { default: config } = (await import(pathToFileURL(file).href)) as {
    default?: BunnyConfig;
  };
  if (!config) throw new Error(`${CONFIG_FILE} has no default export.`);

  return resolveConfig(config);
}

export function resolveConfig(config: BunnyConfig): ResolvedConfig {
  // bunny.net puts the name in hostnames, so it takes what a hostname label takes.
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(config.name ?? "")) {
    throw new Error(
      `name in ${CONFIG_FILE} has to be lowercase letters, digits and hyphens, got "${config.name}".`,
    );
  }

  return {
    name: config.name,
    storage: {
      region: config.storage?.region ?? "DE",
      tier: config.storage?.tier ?? "edge",
      replicationRegions: config.storage?.replicationRegions ?? [],
    },
    productionBranch: config.productionBranch ?? "main",
    keep: {
      production: config.keep?.production ?? 10,
      branch: config.keep?.branch ?? 3,
    },
  };
}
