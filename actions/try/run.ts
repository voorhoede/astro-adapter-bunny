/**
 * Runs an action's committed bundle the way GitHub would, from this machine.
 * bunny.net is real; GitHub's API is the stand-in from github-api.ts, whose
 * deployments stay in .try/github.json between runs.
 *
 *   BUNNYNET_API_KEY=... node actions/try/run.ts deploy --sha <sha> --branch <branch> site=try working_directory=path/to/site
 *
 * --sha and --branch set the commit and branch of the run, --pull-request runs
 * it as a pull request instead of a push, and --default-branch names the
 * repository's default branch (main). Every key=value is an input; inputs
 * left out get their default from action.yml.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { startGitHubApi } from "./github-api.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    sha: { type: "string" },
    branch: { type: "string", default: "main" },
    "pull-request": { type: "boolean", default: false },
    "default-branch": { type: "string", default: "main" },
    repository: { type: "string", default: "voorhoede/astro-adapter-bunny" },
  },
});

const [action, ...assignments] = positionals;
const root = join(import.meta.dirname, "..", "..");
const actionDir = join(root, "actions", action ?? "");
if (!action || !values.sha || !/^[0-9a-f]{7,40}$/.test(values.sha)) {
  console.error("Usage: node actions/try/run.ts <action> --sha <hex sha> [--branch <name>] [--pull-request] [input=value ...]");
  process.exit(1);
}

const sha = values.sha.padEnd(40, "0");
const work = join(root, ".try");
mkdirSync(work, { recursive: true });

// What GitHub fills in from action.yml when a workflow leaves an input out.
const defaults = new Map<string, string>();
let current: string | undefined;
for (const line of readFileSync(join(actionDir, "action.yml"), "utf8").split("\n")) {
  const name = /^ {2}([a-z_]+):\s*$/.exec(line);
  if (name) {
    current = name[1];
  }
  const value = /^ {4}default:\s*"?(.*?)"?\s*$/.exec(line);
  if (current && value) {
    defaults.set(current, value[1] === "${{ github.token }}" ? "test-token" : value[1]);
  }
  if (/^\S/.test(line)) {
    current = undefined;
  }
}

const inputs = new Map(defaults);
if (process.env.BUNNYNET_API_KEY) {
  inputs.set("bunny_api_key", process.env.BUNNYNET_API_KEY);
}
for (const assignment of assignments) {
  const at = assignment.indexOf("=");
  inputs.set(assignment.slice(0, at), assignment.slice(at + 1).replaceAll("\\n", "\n"));
}

const repository = { default_branch: values["default-branch"], full_name: values.repository };
const event = values["pull-request"]
  ? { pull_request: { number: 1, head: { ref: values.branch, sha } }, repository }
  : { repository };
const eventPath = join(work, "event.json");
writeFileSync(eventPath, JSON.stringify(event));
const outputPath = join(work, "output.txt");
writeFileSync(outputPath, "");

const api = await startGitHubApi({ stateFile: join(work, "github.json") });

const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  GITHUB_ACTIONS: "true",
  GITHUB_API_URL: api.url,
  GITHUB_REPOSITORY: values.repository,
  GITHUB_EVENT_NAME: values["pull-request"] ? "pull_request" : "push",
  GITHUB_EVENT_PATH: eventPath,
  // On a pull request GitHub runs on a merge commit of its own.
  GITHUB_SHA: values["pull-request"] ? "f".repeat(40) : sha,
  GITHUB_REF: values["pull-request"] ? "refs/pull/1/merge" : `refs/heads/${values.branch}`,
  GITHUB_OUTPUT: outputPath,
};
for (const [name, value] of inputs) {
  env[`INPUT_${name.toUpperCase()}`] = value;
}

// Not spawnSync: that would block this process, which also answers the action's GitHub requests.
const child = spawn("node", [join(actionDir, "dist", "index.js")], { env, stdio: "inherit" });
const [code] = (await once(child, "exit")) as [number | null];
await api.close();

// Each output is written as name<<delimiter, the value, then the delimiter.
for (const [, name, value] of readFileSync(outputPath, "utf8").matchAll(/^(\w+)<<(\S+)\n([\s\S]*?)\n\2$/gm).map((match) => [match[0], match[1], match[3]])) {
  console.log(`output ${name}: ${value}`);
}
console.log(`\ndeployments (.try/github.json): ${api.deployments().length}`);
process.exit(code ?? 1);
