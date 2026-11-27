# Several sites

## One site per repository

Two sites in two repositories need nothing extra. Each repository uses the workflows from [Production only](production-only.md) or [Pull request previews](pull-request-previews.md), and the actions name every resource after the repository and its owner, so the sites never share a pull zone, a release or a deployment, even in one bunny.net account.

## Several sites in one repository

A monorepo with a folder per site, such as `sites/shop` and `sites/blog`, deploys each site in its own job. Two inputs tell the actions apart:

- `site` names the site's resources on bunny.net. Without it every site would get the repository's name, and the second deploy would replace the first. The owner is added to it, but not the repository, so pick a name no other repository of the same owner uses.
- `working_directory` is the site's folder, with its `dist`, `.bunny/build.json` and `bunny.config.ts`.

Each site also gets its own GitHub environments, so its deployments, URLs and secrets stay apart.

`.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  deployments: write

jobs:
  deploy:
    if: github.event_name == 'push' || (github.event.pull_request.head.repo.full_name == github.repository && !github.event.pull_request.draft)
    runs-on: ubuntu-latest
    strategy:
      # One site failing does not stop the other.
      fail-fast: false
      matrix:
        include:
          - { site: shop, environment: Shop }
          - { site: blog, environment: Blog }
    concurrency:
      group: deploy-${{ github.head_ref || github.ref_name }}-${{ matrix.site }}
      cancel-in-progress: ${{ github.event_name == 'pull_request' }}
    # The environment's secrets, without a deployment of GitHub's own: the actions record the release.
    environment:
      name: ${{ matrix.environment }} ${{ github.event_name == 'pull_request' && 'Pull Request' || 'Production' }}
      deployment: false
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run build -w sites/${{ matrix.site }}
      - id: deploy
        uses: voorhoede/astro-adapter-bunny/actions/deploy@v0.1.0
        with:
          bunny_api_key: ${{ secrets.BUNNY_API_KEY }}
          site: ${{ matrix.site }}
          working_directory: sites/${{ matrix.site }}
          secrets: |
            API_TOKEN=${{ secrets.API_TOKEN }}
      - uses: voorhoede/astro-adapter-bunny/actions/create-deployment@v0.1.0
        with:
          release: ${{ steps.deploy.outputs.release }}
          environment: ${{ matrix.environment }} ${{ github.event_name == 'pull_request' && 'Pull Request' || 'Production' }}
          url: ${{ steps.deploy.outputs.branch_url }}
      - uses: voorhoede/astro-adapter-bunny/actions/clean-up@v0.1.0
        with:
          bunny_api_key: ${{ secrets.BUNNY_API_KEY }}
          site: ${{ matrix.site }}
          environment: ${{ matrix.environment }} ${{ github.event_name == 'pull_request' && 'Pull Request' || 'Production' }}
          releases_to_keep: ${{ github.event_name == 'pull_request' && '1' || '5' }}
```

The shop's production answers at `https://main-shop-{owner}.b-cdn.net/`, and a pull request at `https://feat-new-header-shop-{owner}.b-cdn.net/` next to `https://feat-new-header-blog-{owner}.b-cdn.net/`. `API_TOKEN` comes from the job's environment, so each site can have its own.

The teardown, the rollback and the orphan clean-up take the same `site` and, for the rollback, `working_directory`. A teardown runs per site with the same matrix:

```yaml
jobs:
  teardown:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - { site: shop, environment: Shop }
          - { site: blog, environment: Blog }
    steps:
      - uses: voorhoede/astro-adapter-bunny/actions/teardown@v0.1.0
        with:
          bunny_api_key: ${{ secrets.BUNNY_API_KEY }}
          site: ${{ matrix.site }}
          environment: ${{ matrix.environment }} Pull Request
```

A rollback picks the site with a `workflow_dispatch` input of type `choice` and passes it as `site` and `working_directory: sites/<site>`.

## A second build of the same branch

Sometimes one branch is built twice, such as a production build and a build for content editors that renders every page on request with draft content. The second build is a site of its own: give it its own `site`, so its releases never replace the production build of the same commit, and its own environment.

```yaml
    strategy:
      matrix:
        build: [production, editors]
    env:
      BUNNY_SITE: ${{ matrix.build == 'editors' && 'shop-editors' || 'shop' }}
      ENVIRONMENT: ${{ matrix.build == 'editors' && 'Editors' || 'Production' }}
    steps:
      # ...check out, install and build with the variables the editors build needs
      - id: deploy
        uses: voorhoede/astro-adapter-bunny/actions/deploy@v0.1.0
        with:
          bunny_api_key: ${{ secrets.BUNNY_API_KEY }}
          site: ${{ env.BUNNY_SITE }}
      - uses: voorhoede/astro-adapter-bunny/actions/create-deployment@v0.1.0
        with:
          release: ${{ steps.deploy.outputs.release }}
          environment: ${{ env.ENVIRONMENT }}
          url: ${{ steps.deploy.outputs.branch_url }}
          # Every deployment of the default branch counts as production unless this says otherwise.
          production: ${{ matrix.build == 'production' }}
```

The editors build answers at `https://main-shop-editors-{owner}.b-cdn.net/`. Its rollback passes the same `site` and `production: false`.
