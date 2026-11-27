# Actions

GitHub Actions that deploy a site built with `astro-adapter-bunny` to bunny.net. Each action does one step; the workflow decides the order, the GitHub environment and when each runs.

| Action | Does |
| --- | --- |
| [`deploy`](deploy/action.yml) | Makes a release of the build, checks it on the commit's URL, then moves the branch's pull zone to it. |
| [`create-deployment`](create-deployment/action.yml) | Records the deploy in the repository's Deployments and marks the branch's earlier deployments inactive. |
| [`clean-up`](clean-up/action.yml) | Deletes a branch's releases beyond the newest few, and their deployments. |
| [`teardown`](teardown/action.yml) | Removes a branch's pull zone, its releases and their deployments, such as after a pull request closes. |
| [`rollback`](rollback/action.yml) | Moves a branch's pull zone back to an earlier release and records it as a deployment. |
| [`clean-up-orphans`](clean-up-orphans/action.yml) | Deletes releases no deployment refers to, for a scheduled run. |

Use them as `voorhoede/astro-adapter-bunny/actions/<action>@<ref>`, where the ref is a tag or a commit. The adapter and the actions share their tags.

## What a deploy makes

A **release** is one build of one commit: a storage zone with the files, an Edge Script when the site has a server, and a pull zone of its own, all named `{commit}-{site}-{owner}`, such as `c50ccf3-docs-voorhoede`. Its URL, `https://c50ccf3-docs-voorhoede.b-cdn.net/`, keeps answering with that build for as long as the release exists.

Each branch has one more pull zone, `{branch}-{site}-{owner}`, which the deploy moves to the branch's newest release. Production is the branch pull zone of the repository's default branch. A pull zone name has 5 to 60 characters, so a branch too long to fit is cut and gets a short hash of its full name.

`site` defaults to the repository's name, and the owner is always added, so two repositories never share a name. A repository with several sites, or a second build of the same commits such as a preview, gives each its own `site`.

A deploy makes the release, checks that the commit's URL answers with it, then moves the branch's pull zone and checks that one too. When the branch does not answer with the new release, the deploy moves it back to the release it had and fails. Every deploy also applies the edge rules the build needs (headers from `_headers`, and for a site without a server its redirects, trailing slash and asset caching) and the settings from `bunny.config.ts`. [`docs/deploy.md`](../docs/deploy.md) describes each step.

## Workflow

The deploy reads the build, so it runs after the build in the same job, in the folder with `dist` and `.bunny/build.json`. Every workflow that runs an action with `environment` or `github_token` needs `deployments: write`; the examples below leave the permissions out after the first.

```yaml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  deployments: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: ${{ github.event_name == 'pull_request' && 'Pull Request' || 'Production' }}
      url: ${{ steps.deploy.outputs.branch_url }}
    steps:
      - uses: actions/checkout@v7
        with:
          # On a pull request, the commit people see rather than the merge commit GitHub makes.
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci
      - run: npm run build
      - id: deploy
        uses: voorhoede/astro-adapter-bunny/actions/deploy@<ref>
        with:
          bunny_api_key: ${{ secrets.BUNNY_API_KEY }}
          secrets: |
            API_TOKEN=${{ secrets.API_TOKEN }}
      - uses: voorhoede/astro-adapter-bunny/actions/create-deployment@<ref>
        with:
          environment: ${{ github.event_name == 'pull_request' && 'Pull Request' || 'Production' }}
          url: ${{ steps.deploy.outputs.branch_url }}
      - uses: voorhoede/astro-adapter-bunny/actions/clean-up@<ref>
        with:
          bunny_api_key: ${{ secrets.BUNNY_API_KEY }}
          environment: ${{ github.event_name == 'pull_request' && 'Pull Request' || 'Production' }}
          releases_to_keep: ${{ github.event_name == 'pull_request' && '1' || '5' }}
```

When a pull request closes, its branch can go:

```yaml
on:
  pull_request:
    types: [closed]

jobs:
  teardown:
    runs-on: ubuntu-latest
    steps:
      - uses: voorhoede/astro-adapter-bunny/actions/teardown@<ref>
        with:
          bunny_api_key: ${{ secrets.BUNNY_API_KEY }}
          environment: Pull Request
```

A rollback from the Actions tab, to a given commit or to the release before the current one:

```yaml
on:
  workflow_dispatch:
    inputs:
      commit:
        description: Commit to go back to; empty for the release before the current one
        required: false

jobs:
  rollback:
    runs-on: ubuntu-latest
    steps:
      # Only for bunny.config.ts; without it the pull zone keeps its settings.
      - uses: actions/checkout@v7
      - uses: voorhoede/astro-adapter-bunny/actions/rollback@<ref>
        with:
          bunny_api_key: ${{ secrets.BUNNY_API_KEY }}
          environment: Production
          commit: ${{ inputs.commit }}
```

And a scheduled run for releases a cancelled or failed deploy left behind:

```yaml
on:
  schedule:
    - cron: "0 3 * * *"

jobs:
  clean-up-orphans:
    runs-on: ubuntu-latest
    steps:
      - uses: voorhoede/astro-adapter-bunny/actions/clean-up-orphans@<ref>
        with:
          bunny_api_key: ${{ secrets.BUNNY_API_KEY }}
```

The inputs and outputs of each action are in its `action.yml`.

## Secrets and variables

Script secrets and variables go in as `secrets` and `variables`, one `NAME=value` per line. Every release has its own script, so each deploy sets them all. The deploy fails before it makes anything when the build's `astro:env` schema has a required secret that `secrets` does not set.

## `bunny.config.ts`

A site sets how its resources are made in `bunny.config.ts`, in its `working_directory`. The adapter exports `defineConfig` to type it; the build does not read the file, the `deploy` and `rollback` actions do.

```ts
import { defineConfig } from "astro-adapter-bunny/config";

export default defineConfig({
  storage: { region: "DE", tier: "edge", replicationRegions: ["SE", "ES", "CZ"] },
  pullZone: { regions: ["EU"], minimumTls: "1.2", anonymizeIps: true },
});
```

| Setting | Does |
| --- | --- |
| `storage.region` | The storage zone's main region. Defaults to `DE`. |
| `storage.tier` | `edge` (SSD, the default) or `standard`. |
| `storage.replicationRegions` | Regions the files are copied to. |
| `pullZone.regions` | The regions that serve visitors: `EU`, `US`, `ASIA`, `SA` and `AF`. |
| `pullZone.minimumTls` | The oldest TLS version visitors may connect with: `1.0`, `1.1` or `1.2`. |
| `pullZone.anonymizeIps` | Whether the logs drop part of every visitor's IP address. |

A storage zone's region and tier cannot change, so those apply from the next release. A pull zone setting left unset is not sent, so bunny.net's own value stays. Settings a release needs, such as Smart Cache off, always win over the file.

The file imports `astro-adapter-bunny/config`, so the deploy runs after `npm ci`.

## Running an action locally

`try/run.ts` runs an action's built bundle the way GitHub would, from this repository. bunny.net is real; GitHub's API is a stand-in on localhost that keeps its deployments in `.try/github.json` between runs, so nothing reaches a real repository.

```sh
BUNNYNET_API_KEY=... node actions/try/run.ts deploy --sha c50ccf3 --branch main site=try working_directory=path/to/site
```

`--sha` and `--branch` set the run's commit and branch, `--pull-request` runs it as a pull request, and every `name=value` is an input. Inputs left out get their default from `action.yml`.

## Developing

`shared/` holds what several actions use: bunny.net's API (`bunny/`), names and deployments from GitHub's context (`github/`), and making, switching and deleting releases (`releases/`). Each action is bundled on its own into `dist/index.js`, which GitHub runs as it is, so the bundles are committed:

```sh
npm run build -w actions
```

CI fails when a fresh build changes a committed bundle.
