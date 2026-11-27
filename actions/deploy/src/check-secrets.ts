import type { BuildManifest } from "./manifest.ts";

/** Stops before anything is made on bunny.net when an astro:env secret the build requires has no value. */
export const checkSecrets = ({ manifest, secrets }: { manifest: BuildManifest; secrets: Record<string, string> }) => {
  const required = manifest.requires?.env ?? [];
  const missing = required.filter((field) => field.secret && !field.optional && !secrets[field.name]);
  if (missing.length > 0) {
    throw new Error(`Add these to the secrets input: ${missing.map((field) => field.name).join(", ")}`);
  }
};
