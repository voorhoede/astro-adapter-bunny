export const prerender = false;

export const POST = async ({ request }: { request: Request }) => new Response(await request.text());
