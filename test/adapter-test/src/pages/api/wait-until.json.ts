// Whether the runtime offers the waitUntil the adapter hands to Astro.
export const GET = () =>
  Response.json({
    waitUntil: typeof Reflect.get(globalThis, "Bunny")?.v1?.waitUntil,
  });
