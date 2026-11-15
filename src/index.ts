import type {
  AstroConfig,
  AstroIntegration,
  IntegrationResolvedRoute,
} from "astro";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleServer } from "./lib/bundle-server.ts";
import { printRedirects } from "./lib/print-redirects.ts";
import { writeBuildManifest } from "./lib/write-build-manifest.ts";

export default function bunny(): AstroIntegration {
  let config: AstroConfig;
  let hasServer: boolean;
  let routes: IntegrationResolvedRoute[] = [];

  return {
    name: "astro-adapter-bunny",
    hooks: {
      "astro:config:setup": ({ config: userConfig, updateConfig }) => {
        config = userConfig;

        updateConfig({
          build: { redirects: false },
          image: {
            service: {
              build: { entrypoint: "astro/assets/services/sharp" },
              runtime: { entrypoint: "astro/assets/services/noop" },
            },
          },
        });
      },
      "astro:config:done": ({
        config: resolvedConfig,
        setAdapter,
        buildOutput,
      }) => {
        config = resolvedConfig;

        setAdapter({
          name: "astro-adapter-bunny",
          entrypointResolution: "auto",
          serverEntrypoint: "astro-adapter-bunny/script.ts",
          adapterFeatures: {
            buildOutput,
            preserveBuildClientDir: true,
            preserveBuildServerDir: true,
          },
          supportedAstroFeatures: {
            staticOutput: "stable",
            hybridOutput: "stable",
            serverOutput: "stable",
            i18nDomains: "unsupported",
            envGetSecret: "stable",
            sharpImageService: "limited",
          },
        });
      },
      "astro:routes:resolved": ({ routes: resolvedRoutes }) => {
        routes = resolvedRoutes;
      },
      "astro:build:setup": ({ updateConfig }) => {
        updateConfig({
          ssr: {
            noExternal: true,
            resolve: {
              conditions: ["deno", "module", "node", "development|production"],
            },
          },
        });
      },
      "astro:build:ssr": () => {
        hasServer = true;
      },
      "astro:build:done": async () => {
        const redirects = printRedirects(routes);
        if (redirects) {
          const redirectsFile = join(
            fileURLToPath(config.outDir),
            "_redirects",
          );
          await writeFile(redirectsFile, `${redirects}\n`);
        }

        if (hasServer) {
          const outFile = join(fileURLToPath(config.outDir), "index.js");
          const serverLocation = fileURLToPath(config.build.server);
          const serverEntryFile = config.build.serverEntry;
          const bundledServerCode = await bundleServer(
            serverLocation,
            serverEntryFile,
          );
          await writeFile(outFile, bundledServerCode);
        }

        await writeBuildManifest(config, {
          hasServer: Boolean(hasServer),
          hasRedirects: Boolean(redirects),
        });
      },
    },
  };
}
