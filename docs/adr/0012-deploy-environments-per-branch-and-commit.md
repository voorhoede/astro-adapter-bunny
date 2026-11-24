---
status: accepted; open (secrets per commit script, switching measured from one edge location only)
date: 2026-11-23, rewritten 2026-11-24
---

# A storage zone and script per commit, and pull zones that point at one

## Context and problem statement

The adapter only builds. Developers need a deploy tool that publishes a build, gives every pull request its own preview, rolls back, and removes what a closed pull request left behind, from GitHub Actions and from their own machine. bunny.net's dashboard shows every zone and script on its own, so a site with previews per pull request is hard to manage by hand.

Every release should be isolated in its own storage zone: a fault in cleaning up one release cannot reach another, each release has its own storage password, and bunny.net reports storage and traffic per zone, so each release can be observed on its own.

A custom hostname belongs to one pull zone. Moving it means adding it to another pull zone, where its certificate is issued again; whether the site stays reachable while that happens is untested. A storage zone's tier and main region cannot be changed once it exists, and a replication region cannot be removed once it is added.

Measured on bunny.net on 2026-11-20:

- A new storage zone on the Edge tier in DE accepted its first upload after 2.4 to 4.8 s without replication regions (four zones), and after 1.3 to 3.7 s with SE, ES and CZ (two zones). A new pull zone on it served a file after 4.8 to 5.2 s.
- 30 files (116 KB) took 10 to 15 s to upload to a new zone, eight at a time.
- A pull zone whose origin is another pull zone passed 54 of the test app's 58 checks, against 58 directly. `Astro.clientAddress` named an edge server instead of the visitor, and a POST over http answered 403.

Measured on bunny.net on 2026-11-23, with every request reaching edge servers in DE:

- `POST /pullzone/{id}` with a new `StorageZoneId` and `MiddlewareScriptId` answered 204 but kept the old storage zone, while the script changed. With `OriginType: 2` in the same body, both were stored.
- Without a purge, the edge did not follow the change predictably: once the script changed after 33 s while the storage zone was still the old one after 12 minutes, and once neither changed in 120 s. Requests had unique query strings, so no cached file was involved.
- With `OriginType`, `StorageZoneId` and `MiddlewareScriptId` in one call followed by a purge, seven switches polled from six threads every 100 ms (about 4,500 requests) never answered a script with another release's storage zone. The new pair answered 2 to 7 s after the call, and old and new pairs overlapped across edge servers for at most 0.5 s.
- One middleware script served two pull zones at once, each from its own storage zone, and the script's `LinkedPullZones` listed both.
- An Origin Storage edge rule with another storage zone's id served that zone's file after 39 s, without a purge.
- After a storage zone was deleted, creating one with the same name was refused with `storagezone.name_taken`, "currently being deleted", for the 10 minutes tried.

bunny.net documents 500 pull zones per account by default, raised on request, and no limit on the number of storage zones or Edge Scripts (read on 2026-11-20).

## Considered options

For how a hostname reaches a release:

- **One storage zone per site with a folder per commit, and a pull zone and script per commit and per branch.** A release is a script release that names its commit's folder, so a rollback is one publish and the release history stays in bunny.net. Releases share a zone and its password, a fault in cleaning up a pull request's folders can reach production's, and storage and traffic cannot be told apart per release.
- **A front pull zone per branch whose origin is a commit's pull zone.** Switching is one origin change and a purge, but every request takes a second hop, and the script loses the visitor's address and protocol unless it trusts headers the front pull zone sets.
- **A storage zone per commit, chosen by the script release instead of the pull zone.** A rollback stays one publish with full isolation, but the script has to read storage itself with a password per zone, which changes how it reaches its origin, and a static site has no script to choose with.
- **A storage zone and script per commit, and pull zones that point at one.** A switch changes a pull zone's storage zone and script in one call and purges.

For the choices that are not about the build, such as storage region, tier and replication regions:

- **Options of the adapter, written into the build manifest.** One place, but the build then fixes where it goes, the adapter takes options it does not use, and a changed value suggests a change that bunny.net refuses.
- **Flags on a setup command run once.** The choice is recorded nowhere in the repository, while every commit's zone needs it again.
- **A config file in the project, typed by this package and read by the deploy tool.**

## Decision outcome

**Releases.** A deploy of a commit makes a release: a storage zone and a middleware Edge Script, both named after the site and the commit's short hash. The tool uploads `dist/client` to the zone's root, puts the script's code and its variables and secrets on the script, and publishes it. A release is not changed after that. The script serves from the root of whatever storage zone its pull zone has, so it needs no deploy folders and no line naming one.

**Pull zones.** A pull zone holds no release of its own; it points at one by its storage zone and script. Each branch that deploys has a pull zone, which is that branch's preview. The site has one more pull zone, live, which holds the custom hostnames, added once by hand. Switching a pull zone to a release is one call that sets `OriginType`, `StorageZoneId` and `MiddlewareScriptId` together, followed by a purge, after which the tool checks the pull zone until it answers with the new release.

**Deploy, promote and roll back.** A deploy makes the release, switches the branch's pull zone to it and checks it there. For the production branch the tool then switches live to the same release and checks it again. A rollback switches a pull zone, live or a branch, to an earlier release that still exists. No file is uploaded and no hostname moves.

**History and clean-up.** The releases that exist are the site's storage zones and scripts; a script's release note records the branch and the time of the deploy, so the tool can list releases per branch from bunny.net alone. Each branch keeps its newest releases, more for the production branch than for a pull request, and the tool deletes older ones, never one a pull zone points at, which it checks right before deleting. A site deploys one thing at a time, since a switch during a clean-up could point a pull zone at a release being deleted. A teardown deletes a branch's pull zone and its releases.

**The tool.** The deploy logic is TypeScript in this package, with a command for each step: `setup`, `deploy`, `rollback`, `releases`, `status`, `teardown` and `url`, which prints a branch's URL before the build needs it. GitHub workflows are examples that call these commands and run one deploy per site at a time. The tool owns everything that needs bunny.net's API or the build output: zones, scripts, settings, rules, purges, checks and the lifecycle of releases and pull zones. A workflow owns when a deploy runs, its GitHub environments and secrets, and GitHub deployments. A project owns its content, such as telling a CMS that a build is live.

**Configuration.** A project describes its choices in `bunny.config.ts`, typed by `defineConfig` from this package: the site's name, storage region, tier and replication regions, pull zone settings that can change, the production branch, whether pull requests deploy, build variants such as a preview build, and how many releases each branch keeps. The deploy tool reads it; the build does not. The build manifest keeps what the build itself requires. Every new release's zone gets the current settings. When a pull zone setting that cannot be changed differs from the config, the tool warns, names what to do, and deploys.

### Consequences

- Good: every release has its own storage zone and password, and its storage and traffic show on their own in bunny.net.
- Good: cleaning up a release deletes its zone and script, and cannot touch a folder of another release.
- Good: a rollback or a promotion uploads nothing, and the hostname and its certificate never move.
- Good: a change of storage region, tier or replication applies from the next deploy, without making a zone by hand.
- Good: a site needs a pull zone per branch plus one, not one per kept commit.
- Bad: a switch is correct only with `OriginType` in the call and a purge after it; without either, the edge kept serving the old storage zone for minutes, with or without the new script.
- Bad: variables and secrets belong to a release's script, so a deploy sets them all again, and a rollback brings back the values its release had, including revoked ones.
- Bad: a commit has no URL of its own, so a release is first checked on its branch's pull zone, after visitors of that branch already reach it.
- Bad: a zone's name stays taken for at least 10 minutes after it is deleted, so redeploying a commit whose release was just deleted fails until bunny.net releases the name.
- Bad: after a switch, a page that is open answers 404 for late assets of its own release, and its server islands and actions run the new release, until the visitor reloads.

### Confirmation

A deploy of the test app makes a release whose branch pull zone passes the live checks, a deploy of the production branch also switches live, a rollback serves the previous release's code and files on the live hostname with no request answering one release's script with another's files, and a teardown leaves no pull zone, storage zone or script of the branch.
