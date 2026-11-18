import type { ServerBundle } from "./bundle-server.ts";

// bunny.net accepts the publish of a script that imports one of these, then answers 400 on every request.
const UNSUPPORTED_IMPORTS = [
  "node:child_process",
  "node:vm",
  "node:worker_threads",
  "node:constants",
  "node:path/win32",
];

// bunny.net's limit is 10 MB. Startup grows with size, and from about 7.5 MB a script stopped starting.
const WARN_BYTES = 7_000_000;
const MAX_BYTES = 10_000_000;

export function checkScript({ code, imports }: ServerBundle): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const name of imports.filter((i) => UNSUPPORTED_IMPORTS.includes(i))) {
    errors.push(
      `The server script imports ${name}, which bunny.net Edge Scripts cannot run.` +
        (name === "node:child_process"
          ? " Sharp at runtime does this; use imageService 'compile' or 'passthrough'."
          : ""),
    );
  }

  const bytes = new TextEncoder().encode(code).byteLength;
  const size = `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes > MAX_BYTES) {
    errors.push(`The server script is ${size}, over bunny.net's 10 MB limit.`);
  } else if (bytes > WARN_BYTES) {
    warnings.push(
      `The server script is ${size}. Above 7 MB it may start too slowly on bunny.net.`,
    );
  }

  return { errors, warnings };
}
