export const prerender = true;

export const GET = () =>
  new Response('<rss version="2.0"><channel><title>Feed</title></channel></rss>', {
    headers: { 'content-type': 'application/xml' },
  });
