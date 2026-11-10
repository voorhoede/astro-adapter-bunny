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

## License

[ISC License](license.md)

Copyright (c) 2026 De Voorhoede
