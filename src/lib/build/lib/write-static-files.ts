import type { AstroConfig, IntegrationResolvedRoute } from "astro";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { printRedirects } from "./print-redirects.ts";

/**
 * Writes Astro's redirects to `_redirects` and the printed headers to
 * `_headers` in the client build, and says which of the two files exist.
 */
export async function writeStaticFiles(
  config: AstroConfig,
  routes: IntegrationResolvedRoute[],
  headers: string,
): Promise<{ hasRedirects: boolean; hasHeaders: boolean }> {
  const clientDir = fileURLToPath(config.build.client);

  return {
    hasRedirects: await appendStaticFile(
      join(clientDir, "_redirects"),
      printRedirects(routes, config),
    ),
    hasHeaders: await appendStaticFile(join(clientDir, "_headers"), headers),
  };
}

// The site's own `public/_redirects` or `public/_headers` is already in the client build; its lines stay first.
async function appendStaticFile(
  file: string,
  content: string,
): Promise<boolean> {
  const existing = await readFile(file, "utf8").catch(() => undefined);
  if (!content) return existing !== undefined;

  const prefix = existing?.trimEnd();
  await writeFile(file, `${prefix ? `${prefix}\n` : ""}${content}\n`);
  return true;
}
