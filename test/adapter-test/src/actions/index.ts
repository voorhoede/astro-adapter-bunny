import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';

export const server = {
  greet: defineAction({
    accept: 'form',
    input: z.object({ name: z.string() }),
    handler: ({ name }) => `Hello ${name}`,
  }),
};
