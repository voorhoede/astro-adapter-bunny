import { posix } from "node:path";
import { request, requestList } from "./request.ts";
import type { Script, ScriptCode, ScriptResponse, ScriptSecret, ScriptVariable } from "./types/script.ts";

export const getScript = async ({ name }: { name: string }) => {
  const scripts = await requestList<ScriptResponse>("compute/script", { search: name });
  return scripts.find((script) => script.Name === name);
};

export const createScript = ({ name }: { name: string }) =>
  request<ScriptResponse>("POST", "compute/script", {
    // A script keeps the type it was created with, and only a middleware script lets the pull zone serve stored files.
    body: { Name: name, ScriptType: 2, CreateLinkedPullZone: false } satisfies Script,
  });

export const deleteScript = ({ id }: { id: number }) =>
  request("DELETE", posix.join("compute/script", String(id)), {
    // The tool deletes pull zones itself, in its own order.
    search: { deleteLinkedPullZones: "false" },
  });

/**
 * Puts the code, variables and secrets on a script, then publishes it, so they
 * go live together.
 */
export const publishScript = async ({
  id,
  code,
  variables,
  secrets,
}: {
  id: number;
  code: string;
  variables: Record<string, string>;
  secrets: Record<string, string>;
}) => {
  await request("POST", posix.join("compute/script", String(id), "code"), { body: { Code: code } satisfies ScriptCode });
  await updateScriptValues({ id, variables, secrets });
};

/**
 * Sets variables and secrets on a script and publishes it with the code it
 * has, such as an earlier release's script after a secret was rotated. Values
 * it does not name stay as they are.
 */
export const updateScriptValues = async ({
  id,
  variables,
  secrets,
}: {
  id: number;
  variables: Record<string, string>;
  secrets: Record<string, string>;
}) => {
  const script = posix.join("compute/script", String(id));

  await Promise.all([
    ...Object.entries(variables).map(async ([name, value]) => {
      await request("PUT", posix.join(script, "variables"), {
        body: { Name: name, DefaultValue: value } satisfies ScriptVariable,
      });
    }),
    ...Object.entries(secrets).map(async ([name, value]) => {
      await request("PUT", posix.join(script, "secrets"), {
        body: { Name: name, Secret: value } satisfies ScriptSecret,
      });
    }),
  ]);

  await request("POST", posix.join(script, "publish"), { body: {} });
};
