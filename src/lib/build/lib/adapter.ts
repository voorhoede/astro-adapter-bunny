import type { AstroAdapter } from "astro";

/** The header Astro sends with server island, action and prefetch requests, naming the release that served the page. */
export const RELEASE_HEADER = "x-bunny-release";

/**
 * What the adapter declares to Astro. A site with a script tags the requests
 * an open page makes later with its release, so a newer release can send them
 * on to the release that served the page.
 */
export function adapter(
  buildOutput: "static" | "server",
  commit?: string,
): AstroAdapter {
  const release = commit?.slice(0, 7);

  return {
    name: "astro-adapter-bunny",
    entrypointResolution: "auto",
    serverEntrypoint: "astro-adapter-bunny/script.js",
    // Without a script Astro serves the files itself.
    ...(buildOutput === "server" && {
      previewEntrypoint: "astro-adapter-bunny/preview.js",
    }),
    ...(buildOutput === "server" &&
      release && {
        client: {
          internalFetchHeaders: { [RELEASE_HEADER]: release },
          assetQueryParams: new URLSearchParams({ dpl: release }),
        },
      }),
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
