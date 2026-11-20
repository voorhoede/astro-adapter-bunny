export const GET = () =>
  new Response(new Date().toISOString(), {
    headers: { 'content-type': 'text/plain', 'cdn-cache-control': 'max-age=60' },
  });
