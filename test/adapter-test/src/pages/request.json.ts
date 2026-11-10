export const GET = ({ request, url }: { request: Request; url: URL }) =>
  Response.json({
    astroUrl: url.href,
    requestUrl: request.url,
    headers: Object.fromEntries(request.headers),
  });
