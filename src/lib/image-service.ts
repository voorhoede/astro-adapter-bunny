import type { AstroConfig } from "astro";

type ImageService = AstroConfig["image"]["service"];

/**
 * - `compile`: the project's image service for prerendered pages, no transforms on on-demand pages.
 * - `passthrough`: no transforms anywhere.
 * - `custom`: the project's image service everywhere. It has to run in an Edge Script, which Sharp cannot.
 */
export type ImageServiceOption = "compile" | "passthrough" | "custom";

const noop = { entrypoint: "astro/assets/services/noop", config: {} };

// Returns undefined when the project's own service stays as it is.
export function resolveImageService(
  option: ImageServiceOption,
  configured: ImageService,
): ImageService | undefined {
  switch (option) {
    case "compile":
      return {
        build: "build" in configured ? configured.build : configured,
        runtime: noop,
      };
    case "passthrough":
      return { build: noop, runtime: noop };
    case "custom":
      return undefined;
  }
}
