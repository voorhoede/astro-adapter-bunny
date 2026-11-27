import { readFileSync } from "node:fs";

/** The part of `.bunny/build.json` the deploy reads; astro-adapter-bunny writes it. */
export type BuildManifest = {
  script?: { entry: string };
  assets: { dir: string };
  requires?: { env?: { name: string; secret: boolean; optional?: boolean }[] };
  astroAdapterBunny: {
    trailingSlash: "always" | "never" | "ignore";
    base: string;
    assetsDir: string;
    redirects?: string;
    headers?: string;
  };
};

export const readManifest = (): BuildManifest => {
  try {
    return JSON.parse(readFileSync(".bunny/build.json", "utf8"));
  } catch {
    throw new Error("No .bunny/build.json: build the site with astro-adapter-bunny before deploying it.");
  }
};
