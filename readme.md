# astro-adapter-bunny

Run [Astro](https://astro.build/) on [bunny.net Edge Scripting](https://bunny.net/docs/scripting), as a standalone script or as a middleware script in front of Bunny Storage.

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

| Option | Default | What it does |
| --- | --- | --- |
| `script` | `'standalone'` | `'standalone'` is the pull zone's origin and reads files through the Storage API. `'middleware'` runs in front of a pull zone whose origin is the storage zone. An Edge Script keeps the type it was created with. |

## License

[ISC License](license.md)

Copyright (c) 2026 De Voorhoede
