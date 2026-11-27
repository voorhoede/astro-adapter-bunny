import { defineConfig } from "rolldown";

/**
 * Builds the package's exports into `dist/`. Node refuses to strip types from
 * files under `node_modules`, so a published package ships JavaScript.
 *
 * Bare imports stay imports of the consumer's installed packages, except
 * `@std/*`: those come from JSR through `npm:@jsr/*`, which npmjs.org does not
 * host, so they are bundled.
 */
export default defineConfig({
  input: {
    index: "src/index.ts",
    config: "src/lib/config/config.ts",
    script: "src/lib/runtime/script.ts",
    preview: "src/lib/preview/preview.ts",
    "run-script": "src/lib/preview/run-script.ts",
  },
  external: (id) => /^[^./]/.test(id) && !/^@(std|jsr)\//.test(id),
  platform: "node",
  transform: {
    // `@std/http/file-server` starts its own server when it is the main
    // module, which the bundled runner would be under Deno.
    define: { "import.meta.main": "false" },
  },
  output: { dir: "dist", format: "esm", cleanDir: true },
});
