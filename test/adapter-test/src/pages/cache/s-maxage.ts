export const GET = () =>
  new Response(new Date().toISOString(), {
    headers: { 'content-type': 'text/plain', 'cache-control': 'public, s-maxage=60' },
  });
