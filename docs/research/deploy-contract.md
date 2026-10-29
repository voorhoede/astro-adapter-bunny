# Deploy contract: adapter build output and deploy tooling

What the deploy tooling reads from an adapter build, what it configures on bunny.net, and what the new adapter should emit. The reference site's deploy design leads; bunny-edge-deploy is the generic home it will move to.

## Sources and scope

- **The reference site's deploy tool**: its deploy CLI on the main branch (last changed 2026-10-20), plus its deploy, rollback and teardown workflows.
- **bunny-edge-deploy Action**: an open pull request branch that adds middleware deploys, stacked on an open pull request that adds the build manifest. Neither is on `main` yet. Paths below starting with `src/`, `docs/`, `action.yml` or a bare `.js` file name are in that repository.
- "Verified" means read in code or docs. Nothing was run against bunny.net.
- Clean room: the adapter packages were not opened. Where deploy code touches the adapter, only the import and its use are recorded.

## 1. What the deploy reads from a build

### The build manifest `.bunny/build.json`

Both tools read the same file, but the reference site's deploy tool reads a strict subset.

| Field | Reference site's deploy tool | bunny-edge-deploy |
| --- | --- | --- |
| location | `<siteDir>/.bunny/build.json` | `build-manifest` input, default `.bunny/build.json`; paths resolve from the dir above `.bunny/` (`src/build-manifest/build-manifest.js:28`) |
| `manifestVersion` | ignored (not in its type) | required positive integer; above 1 fails (`build-manifest.js:5,22-24,53`) |
| `adapter.package`, `framework.name` | ignored | required strings, only logged (`build-manifest.js:54-55`, `run.js:181,191`) |
| `kind` | must be `"ssr"` | `"ssr"` or `"static"` (`build-manifest.js:56`) |
| `script.entry` | read as the bundle | must exist as a file (`build-manifest.js:42`) |
| `script.type` | must be `"middleware"` | `"standalone"` or `"middleware"` picks the provisioner (`build-manifest.js:61`, `run.js:87`) |
| `script.bytes` | typed, unused | ignored (`docs/build-manifest.md:17`) |
| `assets.dir` | walked recursively, dotfiles skipped | must exist as a dir (`build-manifest.js:43`) |
| `requires.pullZone` `{disableCookies, enableSmartCache, enableCacheSlice}` | applied | applied, booleans only (`build-manifest.js:6,37`, `desired-state.js:11-14`) |
| `requires.storage.write` | ignored | gates the write password into the script (`platform-env.js:5-6,18`) |
| `requires.env[]` `{name, secret, optional}` | ignored; the tool sets a fixed list | decides which platform variables are set; required ones nobody sets give a warning (`platform-env.js:12-22`, `run.js:107-108`) |

### Other inputs from the build or environment

- **Client files**: content type comes from the extension in both (bunny-edge-deploy: `src/deploy/deploy.js:133`). Files are uploaded with a SHA-256 `Checksum` and skipped when the remote checksum matches (bunny-edge-deploy: `deploy.js:128-135`).
- **Smoke test path**: the reference site's deploy tool hard-codes `/robots.txt` and `/`. The Action uses inputs, else the first hashed asset (`deploy.js:84`, `action.yml:63-68`).
- **Git ref**: the reference site's deploy tool derives branch and sha from GitHub env or `git`; the build mode comes from a preview flag in the environment.
- **App secrets**: the reference site's deploy tool reads a fixed list from process env: a CMS read token, a preview secret and a CMS build trigger id. The Action takes `env` and `secrets` inputs as `KEY=value` lines (`action.yml:15-20`).

### Where the site touches the adapter (recorded, not followed)

- The shared site config imports the vendored adapter and passes `script: 'middleware'`, `sessions: false`, `assetManifest: false`, `pageCacheControl`, `headers`.
- The shared env type declarations type `Astro.locals.runtime` as the adapter's `BunnyRuntime`.
- Each site's package manifest builds the adapter package before the site.
- The deploy code itself imports nothing from the adapter (a search of the deploy tool for the package name: no hits).

## 2. What the deploy configures on bunny.net

| Concern | Reference site's deploy tool | bunny-edge-deploy |
| --- | --- | --- |
| Script type | always middleware, `ScriptType 2` | standalone `1` or middleware `2` from the manifest; a mismatch on an existing script fails (`provision.js:4-5,72-75`) |
| Pull zone origin | storage, `OriginType 2`, `MiddlewareScriptId`, `EdgeScriptExecutionPhase 0` | standalone: script, `OriginType 4`; middleware: the same as the reference site (`desired-state.js:46-78`) |
| Pull zone settings | full desired state re-applied every deploy: EU only, `CacheControl*Override -1`, TLS 1.0/1.1 off, logging with IP anonymization, cache slice off by default | full state on create from inputs (`desired-state.js:16-44`); on existing zones only the build's required settings are enforced (`provision.js:102,134`, `docs/managing-the-zone.md:9-13`) |
| Force SSL | system hostname | every hostname (`managing-the-zone.md:17`) |
| Storage zone | created once by a setup command: Edge tier, DE, replicas SE/ES/CZ; deploy fails if missing | created on first deploy from inputs, default standard DE, no replicas; drift reported, not fixed (`action.yml:33-41`, `provision.js:51-64`) |
| Platform env | always `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_HOST` (hard-coded `storage.bunnycdn.com`), secret `BUNNY_STORAGE_KEY` = read-only password | only what `requires.env` names, from `BUNNY_STORAGE_ZONE/HOST/KEY`, `BUNNY_SESSION_ZONE/KEY`, `BUNNY_PULLZONE_ID`; host is the zone's `StorageHostname` (`platform-env.js:1-8`) |
| App env | overwritten every deploy, variables marked `Required: true` | additive, never removes; refuses platform names; checks the 128 variable limit (`env-sync.js:3-15`, `run.js:184`) |
| Deploy folder | `deploys/<sha7>` or `deploys/<sha7>-preview` | `deploys/<12 hex of a content hash of files and bundle>` (`deploy-folder.js:6-14`) |
| Release note | a tool-specific prefix followed by `{"sha","branch","preview"?}`; the only record of which commit a release serves | free text, default `repo@sha7 run N` (`run.js:102`) |
| Purge | `<url>/*` twice, 5 s apart | `purgeAll` on the zone twice, 5 s apart (`deploy.js:86-90`) |
| Smoke test | static file 2xx and `/` up to 3xx, must carry `cdn-cache` header, retried 60 s | same shape, configurable (`deploy.js:39-44`, `how-it-works.md:28`) |

### Environments, previews, retention

- **The reference site** publishes every commit twice: an immutable commit environment `<sha7>[-preview]-<site>` as a canary, then the moving branch environment `<branch>[-preview]-<site>`. Each is its own script and pull zone.
- **The reference site** builds `main` twice, production and a preview build with its own environments and folders. Pull requests get a branch environment each.
- **The reference site** keeps 5 commits for `main` and 1 for other branches, plus any commit another branch environment still serves. Unclaimed resources go after a 30 min grace.
- **Action** has one environment per run, named by inputs or repo (`run.js:70-82`). It keeps the newest `keep-deploys` folders (default 3) plus the live one (`deploy-folder.js:20-24`, `action.yml:60-62`). There is no preview or per-branch concept.

### Rollback and teardown

- **Both** roll back by republishing an earlier script release. Code and files come back together because the release carries its folder in the prepended line (the reference site's deploy README; bunny-edge-deploy `docs/how-it-works.md:79`).
- **Both** note that variables and secrets belong to the script, not to the release, so a rollback keeps current values (the reference site's deploy README; bunny-edge-deploy `deploy.js:102`).
- **Both** auto roll back the branch or site when its post-publish checks fail (the reference site's deploy step; bunny-edge-deploy `src/deploy/deploy.js:41-44`).
- **The reference site** adds manual rollback by commit with a workflow. It refuses a release whose folder is gone.
- **The reference site** adds teardown on pull request close: it removes the branch environment and its commit environments and folders, and refuses `main` and `preview`.
- **Action** has no manual rollback or teardown command; the summary links the API call (`run.js:118`).

### How a deployed script learns its deploy prefix and storage

- **Deploy prefix (verified)**: both tools prepend one line to the bundle before upload. `globalThis.__BUNNY_DEPLOY__ = {"id", "assetPrefix": "deploys/<id>", "site", "environment"}` (the reference site's deploy step; bunny-edge-deploy `src/deploy/deploy-folder.js:17`, `deploy.js:33`).
  - The reference site's `environment` is the environment name, such as `main-<site>`; the Action always writes `"production"`.
  - The reference site's deploy README calls it "the deploy line the adapter reads"; the Action doc says the adapter reads `assetPrefix` at startup (`docs/build-manifest.md:34`).
- **Storage location (verified)**: via script variables `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_HOST`, `BUNNY_STORAGE_KEY` (see table above).
- **Middleware routing (verified on Bunny by the Action's findings)**: a `Request` returned from `onOriginRequest` with a rewritten path reaches storage at that path, and a visitor's `/deploys/...` gets prefixed again and 404s (bunny-edge-deploy `docs/bunny-findings.md:40`).
- **Standalone routing (Action doc, not verified here)**: the script reads files through the Storage API from the main region (`docs/build-manifest.md:25`, `bunny-findings.md:108`).

## 3. Where the two tools differ

- **Script types**: the reference site's deploy tool supports middleware only; the Action supports standalone, middleware and static (`run.js:85-87`).
- **Deploy id**: commit sha (reference site) versus content hash (Action). A sha ties folders to git for rollback by commit. A hash dedupes identical builds but needs the release note to map back to a commit.
- **Ownership of zone settings**: the reference site's deploy tool enforces a full desired state every deploy; the Action treats the dashboard as source of truth after creation.
- **Env handling**: the reference site's deploy tool overwrites a fixed list; the Action adds what is listed and refuses reserved names.
- **Manifest strictness**: the Action validates and versions the manifest; the reference site's deploy tool trusts a subset and ignores `manifestVersion`.
- **Environments**: the reference site has commit, branch and preview environments, retention per branch, and teardown; the Action has one environment and a folder count.
- **Storage host**: the reference site's deploy tool hard-codes `storage.bunnycdn.com`; the Action uses the zone's `StorageHostname` (regional).
- **Compat checks**: only the Action checks size, imports, `node:` modules and Deno startup time before upload (`docs/build-manifest.md:51-60`).

## 4. Specific to the reference site versus generic

| Specific to the reference site | Generic, belongs in the deploy tool |
| --- | --- |
| Its two sites and their naming | Naming as a pure function of site and ref, with length and slug rules |
| A preview flag as a second build of `main` | Commit plus branch environments, commit as canary |
| Headless CMS secrets and build trigger webhook | Script variables and secrets from a declared list |
| EU-only geo, Edge tier with SE/ES/CZ replicas | Pull zone and storage zone desired state, parameterized |
| `noindex` outside `main`, chosen at build time | Retention per branch, sweep with grace period, teardown on pull request close |
| Its release note prefix | Release note as structured record of commit and branch |
| `/robots.txt` smoke path | Smoke test, purge twice, auto rollback |

## 5. Options for what the new adapter emits

### Option A: emit `.bunny/build.json` version 1 as the Action reads it

- Fields: `manifestVersion: 1`, `adapter.package`, `framework.name`, `kind`, `script.{entry,type}`, `assets.dir`, `requires.{pullZone,storage.write,env}`.
- **Pro**: both tools read it today without changes. The shape is documented in our own Action (`docs/build-manifest.md:7-15`), so we can build it clean room.
- **Con**: no room for what the reference site's deploy design needs, such as which env names are app secrets or a smoke path. Those stay hard-coded in the tool.

### Option B: version 1 plus optional, ignorable fields (recommended)

- Same as A, plus optional fields that both readers already skip: unknown fields are ignored (`build-manifest.js:4`) and the reference site's deploy tool reads only what it types.
- Candidates:
  - `requires.env` entries for the app's `astro:env` server secrets, so the tool stops hard-coding them.
  - `assets.immutable` for the hashed prefix, such as `_astro/`.
  - No `assets.reserved` and no deploy tool work for server code: it ships inside the script (ADR 0007).
  - `smoke.staticPath`.
- **Pro**: no version bump, and it moves the reference site's hard-coded lists into data.
- **Con**: an optional field that one reader ignores silently can drift. Every addition needs a line in the contract doc.

### Option C: a new manifest version 2

- **Pro**: freedom to rename and to make fields required.
- **Con**: the Action fails on versions above 1 (`build-manifest.js:22-24`), so adapter and tool must ship in lockstep. Only worth it for a breaking change, which nothing above requires.

### Runtime handshake: keep the prepended `__BUNNY_DEPLOY__` line

- It must be in the release code, not in a variable, because variables are not part of a release. A prefix in a variable would break rollback of code and files together (the reference site's deploy README).
- The adapter should read only `assetPrefix` as required, and treat `id`, `site` and `environment` as optional diagnostics, since the two tools fill `environment` differently.
- Without the global, the adapter should fail loudly in production rather than serve from the zone root. Local dev and preview need a fallback (open question 3).

### What stays out of the adapter

- Names of zones, scripts, environments and hostnames.
- Commit, branch and preview environments; retention, sweep, rollback, teardown.
- Pull zone geo, tier, TLS, logging; storage tier and replicas.
- Values of secrets, release notes, purge, smoke tests, GitHub Deployments.
- The adapter only declares requirements its runtime depends on, such as `requires.pullZone.enableCacheSlice: false` for middleware ETags (the description of the Action's middleware pull request; `bunny-findings.md:65`).

## Verified, inferred, open

**Verified** (code or docs at the cited places): everything in sections 1 to 4.

**Inferred**:
- The reference site's manifest type matches the Action's field names, so its old adapter likely writes a version 1 manifest. Not checked, by the clean-room rule.
- A local build of the reference site (dated Oct 19) holds `.bunny-adapter.json` and no `.bunny/build.json` exists in the site dir. The local build likely predates the manifest. It was not opened.
- Under middleware, the `BUNNY_STORAGE_*` variables may be unused, since storage is the pull zone origin. The reference site's deploy tool sets them anyway.

**Open questions** (answers recorded 2026-10-28 from the user's decisions, see `docs/design.md`):
1. Does a middleware script need storage credentials at all, for example for a 404 fallback that reads storage directly? The answer decides whether `requires.env` lists them for middleware. **Answered:** yes, required in both types, because both read prerendered error pages through the Storage API, and standalone also reads stored files (ADR 0004). Server code ships inside the script and needs no storage access (ADR 0007).
2. Should the adapter emit `kind: "static"` for fully prerendered sites, which only the Action supports? **Proposed:** yes (ADR 0003).
3. What does the adapter do when `__BUNNY_DEPLOY__` is missing (dev, `astro preview`, a manual upload)? **Answered:** read lazily on the first request, never throw at import; missing means a `private, no-store` 500 and a log line (ADR 0004).
4. Should `environment` in the global be standardized, given the reference site writes a name and the Action writes `"production"`?
5. Which tool owns `_headers` and cache headers for middleware? The reference site's are adapter options today; the Action only parses `_headers` for static builds (`deploy.js:60`). **Answered:** the script applies `_headers` and `_redirects` to stored files in script builds; the deploy tool turns them into edge rules for static builds (ADR 0008).
