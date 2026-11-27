import { readdirSync, existsSync } from "node:fs";
import { defineConfig, type RolldownOptions } from "rolldown";

/**
 * Builds each action into its own `dist/index.js`. GitHub runs that file as it
 * is, without installing anything, so every dependency is bundled in and no
 * chunk is shared between actions.
 */
const actions = readdirSync(new URL(".", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/action.yml`, import.meta.url)))
  .map((entry) => entry.name);

export default defineConfig(
  actions.map(
    (action): RolldownOptions => ({
      input: `${action}/src/index.ts`,
      platform: "node",
      output: { file: `${action}/dist/index.js`, format: "esm" },
    }),
  ),
);
