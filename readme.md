# astro-adapter-bunny

Run [Astro](https://astro.build/) on [bunny.net Edge Scripting](https://bunny.net/docs/scripting).

The package is not published to npm yet.

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

## License

[ISC License](license.md)

Copyright (c) 2026 De Voorhoede
