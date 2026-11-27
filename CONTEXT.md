# astro-adapter-bunny

Builds an Astro site for bunny.net and deploys every commit of it, so each commit and each branch has a URL of its own.

## Language

### On bunny.net

**Site**:
One Astro project deployed to bunny.net, named after its repository unless set; with the repository's owner, its name ends the name of every resource it has there. A second build of the same commits, such as a preview, is a site of its own.
_Avoid_: project, app

**Release**:
Everything bunny.net holds for one build of a commit of a site: its storage zone, its script and its release pull zone. A rebuild of the same commit, such as for changed content, is a release of its own.
_Avoid_: build, version, deploy (for the bunny.net side)

**Release pull zone**:
The pull zone that serves one release for as long as the release exists.
_Avoid_: commit pull zone

**Release URL**:
The address of a release pull zone, which always answers with that release.
_Avoid_: commit URL, preview URL, permalink

**Branch pull zone**:
The pull zone of a branch, which moves to the branch's newest release.
_Avoid_: preview pull zone, environment pull zone

**Branch URL**:
The address of a branch pull zone, which answers with the branch's newest release.
_Avoid_: preview URL

**Production branch**:
The branch whose releases reach the visitors of the site's own domains.
_Avoid_: main, live branch

### Moving between releases

**Switch**:
Pointing a branch pull zone at another release.
_Avoid_: promote, swap

**Rollback**:
A switch to an earlier release that still exists.
_Avoid_: revert, restore

**Clean-up**:
Deleting a branch's releases beyond the newest ones it keeps.
_Avoid_: prune, garbage collection

**Teardown**:
Removing a branch's pull zone and all its releases once the branch is done.
_Avoid_: destroy, delete preview

**Orphaned release**:
A release that no deployment refers to.
_Avoid_: stale release, dangling release

### On GitHub

**Deployment**:
GitHub's record that a release reached a branch, with its commit and the branch URL it answers on.
_Avoid_: release (for the GitHub side)
