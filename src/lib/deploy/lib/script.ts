import type { BunnyApi } from "./bunny-api.ts";
import { findByName } from "./find-by-name.ts";

type Script = { Id: number; Name: string; ScriptType: number };

// A script keeps the type it was created with, and only a middleware script lets the pull zone serve stored files.
const MIDDLEWARE = 2;

export async function findOrCreateScript(
  api: BunnyApi,
  name: string,
): Promise<Script> {
  const existing = await findByName<Script>(api, "/compute/script", name);
  if (existing) {
    if (existing.ScriptType !== MIDDLEWARE) {
      throw new Error(`Script ${name} exists but is not a middleware script.`);
    }
    return existing;
  }

  return api<Script>("POST", "/compute/script", {
    Name: name,
    ScriptType: MIDDLEWARE,
    CreateLinkedPullZone: false,
  });
}

/** Puts the code, variables and secrets on the script, then publishes it, so they go live together. */
export async function publishScript(
  api: BunnyApi,
  script: Script,
  {
    code,
    variables,
    secrets,
  }: {
    code: string;
    variables: Record<string, string>;
    secrets: Record<string, string>;
  },
): Promise<void> {
  const path = `/compute/script/${script.Id}`;

  await api("POST", `${path}/code`, { Code: code });
  await Promise.all([
    ...Object.entries(variables).map(([name, value]) =>
      api("PUT", `${path}/variables`, { Name: name, DefaultValue: value }),
    ),
    ...Object.entries(secrets).map(([name, value]) =>
      api("PUT", `${path}/secrets`, { Name: name, Secret: value }),
    ),
  ]);
  await api("POST", `${path}/publish`, {});
}
