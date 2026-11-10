export const GET = ({ request }: { request: Request }) =>
  new Response(`cookie: ${request.headers.get('cookie') ?? 'none'}`, {
    headers: {
      'content-type': 'text/plain',
      'cache-control': 'public, max-age=60',
      vary: 'cookie',
    },
  });
