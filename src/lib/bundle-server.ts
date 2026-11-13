import { join } from "node:path";
import { rolldown } from "rolldown";

export async function bundleServer(
  serverLocation: string,
  serverEntryFile: string,
) {
  const build = await rolldown({
    input: join(serverLocation, serverEntryFile),
    platform: "node",
  });
  const {
    output: [bundle],
  } = await build.generate({
    format: "esm",
    codeSplitting: false,
  });
  await build.close();

  return bundle.code;
}
