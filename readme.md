# astro-adapter-bunny

Run [Astro](https://astro.build/) on [bunny.net Edge Scripting](https://bunny.net/docs/scripting).

```sh
npm install astro-adapter-bunny
```

## Usage

```ts
// astro.config.ts
import { defineConfig } from 'astro/config';
import bunny from 'astro-adapter-bunny';

export default defineConfig({
  output: 'server',
  adapter: bunny(),
});
```

## Options

`imageService` sets how `<Image>` is transformed. Edge Scripts cannot run Sharp, so on-demand pages get the original image unless the project brings a runtime service of its own.

| Value | Prerendered pages | On-demand pages |
| --- | --- | --- |
| `'compile'` (default) | The project's `image.service`, Sharp unless set | Original, through `/_image` |
| `'passthrough'` | Original | Original, through `/_image` |
| `'custom'` | The project's `image.service` | The project's `image.service`; it has to run in an Edge Script |

```ts
adapter: bunny({ imageService: 'passthrough' }),
```

## Deploy

The adapter only builds. The [GitHub Actions in this repository](actions/README.md) deploy the build to bunny.net: every commit becomes a release with its own URL, and each branch has a URL that moves to its newest release. They record each deploy in GitHub's Deployments, clean up old releases, tear down a branch and roll back.

```yaml
- run: npm run build
- id: deploy
  uses: voorhoede/astro-adapter-bunny/actions/deploy@v0.1.0
  with:
    bunny_api_key: ${{ secrets.BUNNY_API_KEY }}
- uses: voorhoede/astro-adapter-bunny/actions/create-deployment@v0.1.0
  with:
    environment: Production
    url: ${{ steps.deploy.outputs.branch_url }}
```

Complete workflows for common setups:

- [Production only](docs/recipes/production-only.md): deploy the default branch, roll back, and clean up.
- [Pull request previews](docs/recipes/pull-request-previews.md): a preview URL for every pull request, removed when it closes.
- [Several sites](docs/recipes/several-sites.md): one site per repository, several sites in one repository, and a second build of the same branch.

A site sets its storage and pull zone settings in `bunny.config.ts`, typed by `defineConfig` from `astro-adapter-bunny/config`; see the [actions](actions/README.md#bunnyconfigts).

## Preview

`astro preview` runs the built script under [Deno](https://deno.com/), the runtime bunny.net runs it on, so it needs Deno installed. Files come from `dist/client`, the way the storage zone serves them.

## License

[ISC License](license.md)

Copyright (c) 2026 De Voorhoede
