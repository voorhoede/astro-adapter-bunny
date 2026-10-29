import type { APIRoute } from 'astro';

export const prerender = false;

// Spike only: makes n subrequests in one request, one after another or all at once.
export const GET: APIRoute = async ({ url }) => {
  const n = Number(url.searchParams.get('n') ?? 10);
  const parallel = url.searchParams.get('mode') === 'par';
  const target = url.searchParams.get('target') ?? '';
  const start = performance.now();
  const one = async (i: number) => {
    try {
      const response = await fetch(`https://${target}/?i=${i}&r=${url.searchParams.get('r') ?? ''}`);
      await response.arrayBuffer();
      return response.status;
    } catch (error) {
      return String(error).slice(0, 80);
    }
  };
  const statuses: Array<number | string> = [];
  if (parallel) statuses.push(...(await Promise.all(Array.from({ length: n }, (_, i) => one(i)))));
  else for (let i = 0; i < n; i++) statuses.push(await one(i));
  const counts: Record<string, number> = {};
  for (const s of statuses) counts[s] = (counts[s] ?? 0) + 1;
  const firstFailure = statuses.findIndex((s) => s !== 200);
  return Response.json({ n, parallel, ms: Math.round(performance.now() - start), counts, firstFailure });
};
