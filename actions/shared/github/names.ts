import { context } from "@actions/github";

// What bunny.net takes in a name, which also becomes a hostname under b-cdn.net.
export const sanitizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** The site, named after the repository. Every resource of it starts with this. */
export const siteName = () => sanitizeName(context.repo.repo);

/** The branch that was pushed, or the pull request's own branch; on a pull request context.ref is refs/pull/<n>/merge. */
export const branchName = () =>
  context.payload.pull_request?.head.ref ?? context.ref.replace("refs/heads/", "");

/** The commit that was built: a pull request's own commit, not the merge commit GitHub makes. */
export const commitSha = (): string => context.payload.pull_request?.head.sha ?? context.sha;

/** The name of a commit's storage zone, script and commit pull zone. */
export const releaseName = (sha: string) => `${siteName()}-${sha.slice(0, 7)}`;

/** The name of a branch's pull zone, which moves to the branch's newest release. */
export const branchPullZoneName = (branch: string) => `${siteName()}-${sanitizeName(branch)}`;

/** The address bunny.net gives a pull zone. */
export const pullZoneUrl = (name: string) => {
  const url = new URL("https://b-cdn.net");
  url.hostname = `${name}.b-cdn.net`;
  return url;
};
