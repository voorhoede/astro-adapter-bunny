import type {
  AstroConfig,
  AstroIntegration,
  IntegrationResolvedRoute,
} from "astro";
import { adapter, serverBuildConfig } from "./lib/build/lib/adapter.ts";
import {
  type ImageServiceOption,
  resolveImageService,
} from "./lib/build/lib/image-service.ts";
import { printHeaders } from "./lib/build/lib/print-headers.ts";
import { writeBuildManifest } from "./lib/build/lib/write-build-manifest.ts";
import { writeScript } from "./lib/build/lib/write-script.ts";
import { writeStaticFiles } from "./lib/build/lib/write-static-files.ts";

export type Options = {
  /** How images are transformed. Defaults to `compile`. */
  imageService?: ImageServiceOption;
};

export default function bunny({
  imageService = "compile",
}: Options = {}): AstroIntegration {
  let config: AstroConfig;
  let hasServer = false;
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

        setAdapter(adapter(buildOutput));
      },
      "astro:routes:resolved": ({ routes: resolvedRoutes }) => {
        routes = resolvedRoutes;
      },
      "astro:build:setup": ({ updateConfig }) => {
        updateConfig(serverBuildConfig);
      },
      "astro:build:ssr": () => {
        hasServer = true;
      },
      "astro:build:generated": ({ routeToHeaders }) => {
        headers = printHeaders(routeToHeaders);
      },
      "astro:build:done": async ({ logger }) => {
        const staticFiles = await writeStaticFiles(config, routes, headers);

        if (hasServer) {
          await writeScript(config, logger);
        }

        await writeBuildManifest(config, { hasServer, ...staticFiles });
      },
    },
  };
}
