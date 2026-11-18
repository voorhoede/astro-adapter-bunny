import type {
  AstroConfig,
  AstroIntegration,
  IntegrationResolvedRoute,
} from "astro";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendStaticFile } from "./lib/append-static-file.ts";
import { bundleServer } from "./lib/bundle-server.ts";
import { checkScript } from "./lib/check-script.ts";
import {
  type ImageServiceOption,
  resolveImageService,
} from "./lib/image-service.ts";
import { printHeaders } from "./lib/print-headers.ts";
import { printRedirects } from "./lib/print-redirects.ts";
import { writeBuildManifest } from "./lib/write-build-manifest.ts";

export type Options = {
  /** How images are transformed. Defaults to `compile`. */
  imageService?: ImageServiceOption;
};

export default function bunny({
  imageService = "compile",
}: Options = {}): AstroIntegration {
  let config: AstroConfig;
  let hasServer: boolean;
  let routes: IntegrationResolvedRoute[] = [];
  let headers = "";

  return {
    name: "astro-adapter-bunny",
    hooks: {
      "astro:config:setup": ({ config: userConfig, updateConfig }) => {
        config = userConfig;

        const service = resolveImageService(
          imageService,
          userConfig.image.service,
        );
        updateConfig({
          build: { redirects: false },
          ...(service && { image: { service } }),
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
            staticHeaders: true,
          },
          supportedAstroFeatures: {
            staticOutput: "stable",
            hybridOutput: "stable",
            serverOutput: "stable",
            i18nDomains: "unsupported",
            envGetSecret: "stable",
            // Astro only checks this when Sharp is the runtime service, which takes imageService 'custom'.
            sharpImageService: {
              support: "unsupported",
              message:
                "bunny.net Edge Scripts cannot run Sharp, so the build will fail. Use imageService 'compile' to run Sharp at build only.",
              suppress: "default",
            },
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
      "astro:build:generated": ({ routeToHeaders }) => {
        headers = printHeaders(routeToHeaders);
      },
      "astro:build:done": async ({ logger }) => {
        const clientDir = fileURLToPath(config.build.client);
        const redirects = printRedirects(routes, config.base);
        if (redirects) {
          await appendStaticFile(join(clientDir, "_redirects"), redirects);
        }
        if (headers) {
          await appendStaticFile(join(clientDir, "_headers"), headers);
        }

        if (hasServer) {
          const outFile = join(fileURLToPath(config.outDir), "index.js");
          const serverLocation = fileURLToPath(config.build.server);
          const serverEntryFile = config.build.serverEntry;
          const script = await bundleServer(serverLocation, serverEntryFile);
          const { errors, warnings } = checkScript(script);
          for (const warning of warnings) logger.warn(warning);
          if (errors.length) throw new Error(errors.join("\n"));
          await writeFile(outFile, script.code);
        }

        await writeBuildManifest(config, {
          hasServer: Boolean(hasServer),
          hasRedirects: await exists(join(clientDir, "_redirects")),
          hasHeaders: await exists(join(clientDir, "_headers")),
        });
      },
    },
  };
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}
