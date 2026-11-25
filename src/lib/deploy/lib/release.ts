import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BuildManifest } from "./build-manifest.ts";
import type { BunnyApi } from "./bunny-api.ts";
import type { ResolvedConfig } from "./config.ts";
import type { EdgeRule } from "./edge-rules.ts";
import { pullZoneUrl, releaseName } from "./names.ts";
import { findOrCreatePullZone } from "./pull-zone.ts";
import { findOrCreateScript, publishScript } from "./script.ts";
import {
  findOrCreateStorageZone,
  putFile,
  setNotFoundPage,
  uploadDirectory,
} from "./storage-zone.ts";

export type Release = {
  name: string;
  commit: string;
  url: string;
  storageZoneId: number;
  scriptId?: number;
};

/** Where a release's file sits under the site's base, such as `/docs/.bunny/release.json`. */
export function releaseFilePath(base: string): string {
  return `${base.replace(/\/?$/, "/")}.bunny/release.json`;
}

/**
 * Makes a commit's release: its storage zone and script at the same time, then
 * its commit pull zone while the files upload and the script publishes. Every
 * part is found by name first, so a deploy that failed halfway can run again.
 */
export async function createRelease(
  api: BunnyApi,
  {
    root,
    config,
    manifest,
    commit,
    branch,
    variables,
    secrets,
    rules,
  }: {
    root: string;
    config: ResolvedConfig;
    manifest: BuildManifest;
    commit: string;
    branch: string;
    variables: Record<string, string>;
    secrets: Record<string, string>;
    rules: EdgeRule[];
  },
): Promise<Release> {
  const name = releaseName(config.name, commit);
  const hasScript = manifest.script !== undefined;

  const [storageZone, script] = await settled([
    findOrCreateStorageZone(api, name, config.storage),
    hasScript ? findOrCreateScript(api, name) : Promise.resolve(undefined),
  ]);

  const clientDir = join(root, manifest.assets.dir);
  const prefix = manifest.astroAdapterBunny.base.replace(/^\/|\/$/g, "");
  const inBase = (path: string) => [prefix, path].filter(Boolean).join("/");

  await settled([
    findOrCreatePullZone(api, name, {
      storageZoneId: storageZone.Id,
      scriptId: script?.Id,
    }, rules),
    (async () => {
      // The redirect and header files become edge rules; they are not for visitors.
      const skip = [
        manifest.astroAdapterBunny.redirects,
        manifest.astroAdapterBunny.headers,
      ].flatMap((file) => (file ? [file.slice(manifest.assets.dir.length + 1)] : []));

      await uploadDirectory(storageZone, clientDir, { prefix, skip });
      if (await exists(join(clientDir, "404.html"))) {
        await setNotFoundPage(api, storageZone, `/${inBase("404.html")}`);
      }
      // Written after the other files, so a pull zone that answers with it has all of them.
      await putFile(
        storageZone,
        releaseFilePath(manifest.astroAdapterBunny.base).slice(1),
        JSON.stringify({ commit, branch, deployedAt: new Date().toISOString() }),
      );
    })(),
    script && manifest.script
      ? publishScript(api, script, {
          code: await readFile(join(root, manifest.script.entry), "utf8"),
          variables,
          secrets,
        })
      : Promise.resolve(),
  ]);

  return {
    name,
    commit,
    url: pullZoneUrl(name),
    storageZoneId: storageZone.Id,
    ...(script && { scriptId: script.Id }),
  };
}

// Waits for every step, so a failing one does not leave another running unseen, and reports all failures.
async function settled<T extends readonly unknown[]>(
  steps: [...{ [K in keyof T]: Promise<T[K]> }],
): Promise<T> {
  const results = await Promise.allSettled(steps);
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, errors.map(String).join("\n"));
  }

  return results.map((result) =>
    result.status === "fulfilled" ? result.value : undefined,
  ) as unknown as T;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
