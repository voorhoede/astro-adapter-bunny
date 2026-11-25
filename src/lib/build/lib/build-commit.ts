import { execFileSync } from "node:child_process";

/**
 * The commit being built: `BUNNY_COMMIT` when a workflow sets it, else
 * `GITHUB_SHA`, else the checkout's `HEAD`. The build tags its requests with
 * it, and the deploy names the release after it, so both agree on the release.
 * Undefined outside a git checkout, which leaves the build untagged.
 */
export function buildCommit(root: string): string | undefined {
  const commit =
    process.env.BUNNY_COMMIT ?? process.env.GITHUB_SHA ?? gitHead(root);
  return commit && /^[0-9a-f]{40}$/i.test(commit)
    ? commit.toLowerCase()
    : undefined;
}

function gitHead(root: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}
