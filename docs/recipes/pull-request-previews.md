# Pull request previews

Production from the default branch, plus a preview of every pull request at a URL of its own that follows the branch. When the pull request closes, its preview goes.

It builds on [Production only](production-only.md): the rollback and orphan workflows there stay as they are.

## Deploy

`.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    # ready_for_review deploys a draft once it is marked ready.
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  deployments: write

jobs:
  deploy:
    # Forks get no secrets, so they cannot deploy; drafts wait until they are ready.
    if: github.event_name == 'push' || (github.event.pull_request.head.repo.full_name == github.repository && !github.event.pull_request.draft)
    runs-on: ubuntu-latest
    # A newer push to a pull request cancels its running deploy; main waits, so production is never left half switched.
    concurrency:
      group: deploy-${{ github.head_ref || github.ref_name }}
      cancel-in-progress: ${{ github.event_name == 'pull_request' }}
    # The environment's secrets, without a deployment of GitHub's own: the actions record the release.
    environment:
      name: ${{ github.event_name == 'pull_request' && 'Pull Request' || 'Production' }}
      deployment: false
    steps:
      - uses: actions/checkout@v7
        with:
          # The commit people see on the pull request, not the merge commit GitHub makes.
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
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
          secrets: |
            API_TOKEN=${{ secrets.API_TOKEN }}
      - uses: voorhoede/astro-adapter-bunny/actions/create-deployment@v0.1.0
        with:
          environment: ${{ github.event_name == 'pull_request' && 'Pull Request' || 'Production' }}
          url: ${{ steps.deploy.outputs.branch_url }}
      # main keeps five releases to roll back to; a pull request only needs the one it shows.
      - uses: voorhoede/astro-adapter-bunny/actions/clean-up@v0.1.0
        with:
          bunny_api_key: ${{ secrets.BUNNY_API_KEY }}
          environment: ${{ github.event_name == 'pull_request' && 'Pull Request' || 'Production' }}
          releases_to_keep: ${{ github.event_name == 'pull_request' && '1' || '5' }}
```

A pull request from `feat/new-header` answers at `https://feat-new-header-{repository}-{owner}.b-cdn.net/`, and GitHub links it from the pull request as a deployment. The job uses its environment with `deployment: false`: it gets that environment's secrets, while `create-deployment` records the one deployment, with the release, instead of GitHub adding one of its own. A branch name too long for bunny.net's 60 characters is cut and gets a short hash.

The two environments can hold different secrets, such as a token for draft content in `Pull Request`. The actions only read what the workflow passes them, so the environment decides.

## Tear down

`.github/workflows/teardown.yml`:

```yaml
name: Teardown

on:
  pull_request:
    types: [closed]

permissions:
  contents: read
  deployments: write

jobs:
  teardown:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    # Waits for a deploy of the same branch that is still running.
    concurrency:
      group: deploy-${{ github.head_ref }}
      cancel-in-progress: false
    steps:
      - uses: voorhoede/astro-adapter-bunny/actions/teardown@v0.1.0
        with:
          bunny_api_key: ${{ secrets.BUNNY_API_KEY }}
          environment: Pull Request
```

The teardown deletes the branch's pull zone, its releases and their deployments. It refuses the default branch. A release that another branch's pull zone still serves stays.

Right after a release is deleted, bunny.net refuses a new storage zone with its name for a while, so reopening a pull request right after it closed can fail the first deploy of the same commit. A new push, or running the deploy again a little later, works.

## Search engines

Previews are public URLs. Keep them out of search engines with an `X-Robots-Tag: noindex` header on every build but production, for example from a `public/_headers` file that the build writes for previews only; the deploy turns `_headers` into edge rules. Set Astro's `site` to the production domain for every build, so a preview's canonical URLs point at production.
