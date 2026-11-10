export const GET = () => {
  const value = crypto.randomUUID();
  return new Response(value, {
    headers: {
      'content-type': 'text/plain',
      'cache-control': 'public, max-age=60',
      'set-cookie': `session=${value}; Path=/; HttpOnly`,
    },
  });
};
