import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { CreatePreviewServer } from "astro";

const RUNNER = fileURLToPath(new URL("run-script.ts", import.meta.url));

/**
 * `astro preview`: runs the built script under Deno, since the bundle holds the
 * Deno variant of the edge script SDK, which cannot serve from Node.
 */
const createPreviewServer: CreatePreviewServer = ({
  outDir,
  client,
  host,
  port,
  base,
  logger,
}) => {
  const script = fileURLToPath(new URL("index.js", outDir));
  if (!existsSync(script)) {
    throw new Error(`${script} does not exist. Run \`astro build\` first.`);
  }

  const hostname = host ?? "localhost";
  const deno = spawn(
    "deno",
    [
      "run",
      "--allow-net",
      "--allow-read",
      "--allow-env",
      "--allow-sys",
      RUNNER,
      script,
      fileURLToPath(client),
      hostname,
      String(port),
    ],
    // Deno exits when stdin closes, so it stops with this process however that ends.
    { stdio: ["pipe", "pipe", "inherit"] },
  );

  const closed = new Promise<void>((resolve) => deno.once("exit", () => resolve()));

  return new Promise((resolve, reject) => {
    deno.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            "`astro preview` runs the script under Deno, which was not found. Install it from https://docs.deno.com/runtime/getting_started/installation/",
          ),
        );
        return;
      }
      reject(error);
    });
    deno.once("exit", (code) => {
      reject(new Error(`Deno exited with code ${code} before the preview started.`));
    });

    let ready = false;
    createInterface({ input: deno.stdout }).on("line", (line) => {
      if (!ready && line === "ready") {
        ready = true;
        logger.info(`Preview at http://${hostname}:${port}${base}`);
        resolve({
          host: hostname,
          port,
          closed: () => closed,
          stop: async () => {
            deno.kill();
            await closed;
          },
        });
        return;
      }
      console.log(line);
    });
  });
};

export default createPreviewServer;
