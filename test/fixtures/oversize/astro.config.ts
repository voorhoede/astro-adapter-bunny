import { defineConfig } from 'astro/config';
import bunny from '../../../src/build/integration.ts';

export default defineConfig({ adapter: bunny() });
