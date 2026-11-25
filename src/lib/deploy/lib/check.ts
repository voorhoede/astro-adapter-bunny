import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { BuildManifest } from "./build-manifest.ts";

/**
 * Waits until a new pull zone answers: a stored file of the build with 200,
 * and for a site with a script, its base path with anything but a server
 * error. A new pull zone served its first file after about 5 s.
 */
export async function waitUntilServing(
  url: string,
  { root, manifest }: { root: string; manifest: BuildManifest },
  { timeout = 120_000 }: { timeout?: number } = {},
): Promise<void> {
  const base = manifest.astroAdapterBunny.base.replace(/\/?$/, "/");
  const file = await anyStoredFile(join(root, manifest.assets.dir), manifest);
  const probes = [
    ...(file ? [{ path: `${base}${file}`, ok: (status: number) => status === 200 }] : []),
    ...(manifest.script ? [{ path: base, ok: (status: number) => status < 500 }] : []),
  ];

  const deadline = Date.now() + timeout;
  for (const probe of probes) {
    let last = "no answer";
    for (;;) {
      try {
        const response = await fetch(`${url}${probe.path}?check=${Date.now()}`, {
          redirect: "manual",
        });
        await response.body?.cancel();
        if (probe.ok(response.status)) break;
        last = String(response.status);
      } catch (error) {
        last = String(error);
      }

      if (Date.now() > deadline) {
        throw new Error(`${url}${probe.path} did not answer in time; last: ${last}.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// A file in the assets folder has a hashed name, so it can only come from this build.
async function anyStoredFile(
  dir: string,
  manifest: BuildManifest,
): Promise<string | undefined> {
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"),
    )
    .filter((path) => !path.startsWith("_redirects") && !path.startsWith("_headers"));

  return (
    files.find((path) => path.startsWith(`${manifest.astroAdapterBunny.assetsDir}/`)) ??
    files[0]
  );
}
