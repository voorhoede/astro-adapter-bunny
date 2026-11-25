import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { BunnyApi } from "./bunny-api.ts";
import type { ResolvedConfig } from "./config.ts";
import { findByName } from "./find-by-name.ts";

export type StorageZone = {
  Id: number;
  Name: string;
  Password: string;
  StorageHostname: string;
};

const TIERS = { standard: 0, edge: 1 } as const;

export async function findOrCreateStorageZone(
  api: BunnyApi,
  name: string,
  storage: ResolvedConfig["storage"],
): Promise<StorageZone> {
  const existing = await findByName<StorageZone>(api, "/storagezone", name);
  if (existing) return existing;

  return api<StorageZone>("POST", "/storagezone", {
    Name: name,
    Region: storage.region,
    ReplicationRegions: storage.replicationRegions,
    ZoneTier: TIERS[storage.tier],
  });
}

/** Storage answers a path no file has with this page, or with bunny.net's own 404 page when it is empty. */
export async function setNotFoundPage(
  api: BunnyApi,
  zone: StorageZone,
  path: string,
): Promise<void> {
  await api("POST", `/storagezone/${zone.Id}`, {
    Custom404FilePath: path,
    Rewrite404To200: false,
  });
}

/**
 * Uploads every file of `dir` under `prefix`, a few at a time. A new zone can
 * refuse uploads for a few seconds, so a failed upload is tried again.
 */
export async function uploadDirectory(
  zone: StorageZone,
  dir: string,
  { prefix = "", skip = [] }: { prefix?: string; skip?: string[] } = {},
): Promise<number> {
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"),
    )
    .filter((path) => !skip.includes(path));

  await inBatches(files, 8, async (path) => {
    const target = [prefix, path].filter(Boolean).join("/");
    const body = await readFile(join(dir, path));
    await withRetries(() => uploadFile(zone, target, body));
  });

  return files.length;
}

/** Writes one file, trying again while a new zone still refuses uploads. */
export async function putFile(
  zone: StorageZone,
  path: string,
  body: string,
): Promise<void> {
  await withRetries(() => uploadFile(zone, path, Buffer.from(body)));
}

/** Reads one file, or answers undefined when the zone has none at that path. */
export async function getFile(
  zone: StorageZone,
  path: string,
): Promise<string | undefined> {
  const response = await fetch(fileUrl(zone, path), {
    headers: { AccessKey: zone.Password },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`Reading ${path} answered ${response.status}.`);
  }
  return response.text();
}

function fileUrl(zone: StorageZone, path: string): string {
  return `https://${zone.StorageHostname}/${zone.Name}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function uploadFile(
  zone: StorageZone,
  path: string,
  body: Buffer,
): Promise<void> {
  const response = await fetch(fileUrl(zone, path), {
    method: "PUT",
    headers: {
      AccessKey: zone.Password,
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(body),
  });

  if (!response.ok) {
    throw new Error(
      `Uploading ${path} answered ${response.status}: ${await response.text()}`,
    );
  }
}

async function inBatches<T>(
  items: T[],
  size: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: size }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await run(item);
    }
  });
  await Promise.all(workers);
}

async function withRetries<T>(run: () => Promise<T>, tries = 8): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= tries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}
