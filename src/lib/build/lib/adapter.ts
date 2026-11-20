import type { AstroAdapter } from "astro";
import {
  DEPLOY_ID_HEADER,
  DEPLOY_ID_QUERY,
} from "../../runtime/lib/deploy-id.ts";

/**
 * What the adapter declares to Astro. With a deploy id, Astro tags asset URLs
 * and its own fetches with it, so an edge rule can send a page's later
 * requests to the deploy that served it.
 */
export function adapter(
  buildOutput: "static" | "server",
  deployId: string | undefined,
): AstroAdapter {
  return {
    name: "astro-adapter-bunny",
    entrypointResolution: "auto",
    serverEntrypoint: "astro-adapter-bunny/script.ts",
    // Without a script Astro serves the files itself.
    ...(buildOutput === "server" && {
      previewEntrypoint: "astro-adapter-bunny/preview.ts",
    }),
    adapterFeatures: {
      buildOutput,
      preserveBuildClientDir: true,
      preserveBuildServerDir: true,
      staticHeaders: true,
    },
    ...(deployId && {
      client: {
        assetQueryParams: new URLSearchParams({ [DEPLOY_ID_QUERY]: deployId }),
        internalFetchHeaders: { [DEPLOY_ID_HEADER]: deployId },
      },
    }),
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
  };
}

/**
 * The server build bundles everything, and resolves the `deno` export condition
 * first, since bunny.net runs Deno. Without it, the edge script SDK resolved to
 * its Node variant, which pulled Node's http server into the script.
 */
export const serverBuildConfig = {
  ssr: {
    noExternal: true as const,
    resolve: {
      conditions: ["deno", "module", "node", "development|production"],
    },
  },
};
