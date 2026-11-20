import type { AstroConfig, AstroIntegrationLogger } from "astro";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleServer } from "./bundle-server.ts";
import { checkScript } from "./check-script.ts";

/**
 * Bundles Astro's server build into `dist/index.js`, the Edge Script. Fails the
 * build, without writing it, when bunny.net could not run it.
 */
export async function writeScript(
  config: AstroConfig,
  logger: AstroIntegrationLogger,
): Promise<void> {
  const script = await bundleServer(
    fileURLToPath(config.build.server),
    config.build.serverEntry,
  );

  const { errors, warnings } = checkScript(script);
  for (const warning of warnings) logger.warn(warning);
  if (errors.length) throw new Error(errors.join("\n"));

  await writeFile(join(fileURLToPath(config.outDir), "index.js"), script.code);
}
