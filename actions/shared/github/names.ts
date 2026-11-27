import { getInput } from "@actions/core";
import { context } from "@actions/github";
import { createHash } from "node:crypto";

// What bunny.net takes in a name, which also becomes a hostname under b-cdn.net.
export const sanitizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// bunny.net takes a pull zone name of 5 to 60 characters, and a storage zone name of up to 63.
const MAX_NAME = 60;
// What a release adds before the site: its eight hex characters and a hyphen.
const RELEASE_PREFIX = 9;

/**
 * The site and its owner, such as astro-adapter-bunny-voorhoede. The site is
 * the `site` input, or the repository's name; the owner always follows, so two
 * owners never share names. Every resource of it ends with this, after the
 * commit or the branch it is for.
 */
export const siteName = () => {
  const site = `${sanitizeName(getInput("site") || context.repo.repo)}-${sanitizeName(context.repo.owner)}`;
  if (site.length > MAX_NAME - RELEASE_PREFIX) {
    throw new Error(`The site name ${site} is longer than ${MAX_NAME - RELEASE_PREFIX} characters, which leaves no room for a release.`);
  }
  return site;
};

/** The branch that was pushed, or the pull request's own branch; on a pull request context.ref is refs/pull/<n>/merge. */
export const branchName = () =>
  context.payload.pull_request?.head.ref ?? context.ref.replace("refs/heads/", "");

/** The commit that was built: a pull request's own commit, not the merge commit GitHub makes. */
export const commitSha = (): string => context.payload.pull_request?.head.sha ?? context.sha;

/**
 * The name of this run's release, its storage zone, script and pull zone, such
 * as 3f9a1c2e-astro-adapter-bunny-voorhoede: a hash of the workflow run and
 * its attempt, so every build is a release of its own, also a rebuild of the
 * same commit, and a name is never used twice, which bunny.net refuses for a
 * while after a delete. A deploy that runs again in the same attempt goes on
 * with its own release. The commit is in the release file and the deployment.
 */
export const releaseName = () => {
  const hash = createHash("sha256").update(`${context.runId}-${context.runAttempt}`).digest("hex").slice(0, 8);
  return `${hash}-${siteName()}`;
};

/** Whether a name is a release of this site, as releaseName makes it. */
export const isReleaseName = (name: string) => new RegExp(`^[0-9a-f]{8}-${siteName()}$`).test(name);

/** Whether a resource belongs to this site: a release or a branch pull zone. */
export const isSiteResource = (name: string) => name.endsWith(`-${siteName()}`);

/**
 * The name of a branch's pull zone, such as feat-try-astro-adapter-bunny-voorhoede.
 * A branch too long to fit is cut, with a short hash of its full name, so two
 * long branches that start alike still get different names.
 */
export const branchPullZoneName = (branch: string) => {
  const site = siteName();
  const slug = sanitizeName(branch);
  const room = MAX_NAME - site.length - 1;
  if (slug.length <= room) {
    return `${slug}-${site}`;
  }

  const hash = createHash("sha256").update(branch).digest("hex").slice(0, 6);
  const cut = slug.slice(0, room - hash.length - 1).replace(/-+$/, "");
  return `${cut}-${hash}-${site}`;
};

/** The address bunny.net gives a pull zone. */
export const pullZoneUrl = (name: string) => {
  const url = new URL("https://b-cdn.net");
  url.hostname = `${name}.b-cdn.net`;
  return url;
};
