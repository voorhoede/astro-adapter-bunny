/** A delivery region of bunny.net's edge network. */
export type Region = "EU" | "US" | "ASIA" | "SA" | "AF";

/**
 * How a site's resources on bunny.net are made, in the project's
 * `bunny.config.ts`. The deploy reads it on every deploy; the build does not.
 */
export type BunnyConfig = {
  storage?: {
    /** The main region, such as `DE`. A zone's region cannot change, so this applies from the next release. Defaults to `DE`. */
    region?: string;
    /** `edge` (SSD) or `standard`. A zone's tier cannot change, so this applies from the next release. Defaults to `edge`. */
    tier?: "edge" | "standard";
    /** Regions storage replicates to, such as `["SE", "ES", "CZ"]`. A region cannot be removed from a zone. */
    replicationRegions?: string[];
  };
  pullZone?: {
    /** The regions that serve visitors. Unset, bunny.net's own choice stays. */
    regions?: Region[];
    /** The oldest TLS version visitors may connect with. Unset, bunny.net's own choice stays. */
    minimumTls?: "1.0" | "1.1" | "1.2";
    /** Whether the logs drop a digit of every visitor's IP address. Unset, bunny.net's own choice stays. */
    anonymizeIps?: boolean;
  };
};

/** Types a project's `bunny.config.ts`. */
export const defineConfig = (config: BunnyConfig = {}): BunnyConfig => config;
