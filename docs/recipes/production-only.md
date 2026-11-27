# Production only

One site, deployed from the default branch. Every push to `main` becomes a release, the site's URL moves to it, and older releases are deleted. A rollback goes back to one of the releases that are kept.

## Deploy

`.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  contents: read
  deployments: write

# One deploy at a time; a newer push waits instead of cancelling, so production is never left half switched.
concurrency:
  group: deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    # The environment's secrets, without a deployment of GitHub's own: the actions record the release.
    environment:
      name: Production
      deployment: false
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run build
      - id: deploy
        uses: voorhoede/astro-adapter-bunny/actions/deploy@v0.1.0
        with:
          bunny_api_key: ${{ secrets.BUNNY_API_KEY }}
          # The astro:env secrets the site reads at runtime; the deploy stops when a required one is missing.
          secrets: |
            API_TOKEN=${{ secrets.API_TOKEN }}
      - uses: voorhoede/astro-adapter-bunny/actions/create-deployment@v0.1.0
        with:
          environment: Production
          url: ${{ steps.deploy.outputs.branch_url }}
      - uses: voorhoede/astro-adapter-bunny/actions/clean-up@v0.1.0
        with:
          bunny_api_key: ${{ secrets.BUNNY_API_KEY }}
          environment: Production
          releases_to_keep: 5
```

The site answers at `https://main-{repository}-{owner}.b-cdn.net/`, and each release keeps its own URL, `https://{commit}-{repository}-{owner}.b-cdn.net/`, until the clean-up deletes it. A custom domain goes on the `main` pull zone in bunny.net's dashboard; the deploy leaves hostnames alone.

Set Astro's `site` to the production domain in `astro.config.ts`, so canonical URLs and the sitemap point at it.

## Roll back

`.github/workflows/rollback.yml`, run from the Actions tab:

```yaml
name: Rollback

on:
  workflow_dispatch:
    inputs:
      commit:
        description: Commit to go back to, from the Deployments page; empty for the release before the current one
        required: false

permissions:
  contents: read
  deployments: write

concurrency:
  group: deploy
  cancel-in-progress: false

jobs:
  rollback:
    runs-on: ubuntu-latest
    # The environment's secrets, without a deployment of GitHub's own: the actions record the release.
    environment:
      name: Production
      deployment: false
    steps:
      # For bunny.config.ts only; without it the pull zone keeps its settings.
      - uses: actions/checkout@v7
      - id: rollback
        uses: voorhoede/astro-adapter-bunny/actions/rollback@v0.1.0
        with:
          bunny_api_key: ${{ secrets.BUNNY_API_KEY }}
          environment: Production
          commit: ${{ inputs.commit }}
```

A rollback can only go back to a release the clean-up kept, so `releases_to_keep` is also how far back a rollback reaches. It shares the deploy's concurrency group, so the two never switch the pull zone at the same time.

## Orphans

A deploy that fails or is cancelled after it made its release, but before it recorded the deployment, leaves a release no clean-up knows about. A scheduled run removes those:

```yaml
name: Clean up orphans

on:
  schedule:
    - cron: "0 3 * * *"

permissions:
  contents: read
  deployments: read

jobs:
  clean-up-orphans:
    runs-on: ubuntu-latest
    steps:
      - uses: voorhoede/astro-adapter-bunny/actions/clean-up-orphans@v0.1.0
        with:
          bunny_api_key: ${{ secrets.BUNNY_API_KEY }}
```

Run it once with `dry_run: true` to see what it would delete.
