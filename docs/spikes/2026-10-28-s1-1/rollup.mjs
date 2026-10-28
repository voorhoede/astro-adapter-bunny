import { rollup } from 'rollup';
const bundle = await rollup({ input: 'src/entry.js' });
await bundle.write({ dir: 'parts', format: 'system', entryFileNames: '[name].js', chunkFileNames: '[name].js' });
