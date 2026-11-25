// Every resource is found by its name, so a deploy that failed halfway can pick up what it already made.

/** The storage zone, script and commit pull zone of a release. */
export function releaseName(site: string, commit: string): string {
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
    throw new Error(`"${commit}" is not a commit hash.`);
  }
  return `${site}-${commit.slice(0, 7).toLowerCase()}`;
}

/** The pull zone that moves to a branch's newest release. */
export function branchName(site: string, branch: string): string {
  const slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error(`Branch "${branch}" gives an empty name.`);
  return `${site}-${slug}`;
}

/** The pull zone that holds the custom hostnames. */
export function liveName(site: string): string {
  return site;
}

/** A pull zone answers on its name under b-cdn.net. */
export function pullZoneUrl(name: string): string {
  return `https://${name}.b-cdn.net`;
}
