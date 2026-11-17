import { readFile, writeFile } from "node:fs/promises";

// The site's own `public/_redirects` or `public/_headers` is already in the client build; its lines stay first.
export async function appendStaticFile(
  file: string,
  content: string,
): Promise<void> {
  const existing = await readFile(file, "utf8").catch(() => "");
  const prefix = existing.trimEnd();
  await writeFile(file, `${prefix ? `${prefix}\n` : ""}${content}\n`);
}
