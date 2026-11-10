export function restoreVisitorUrl(request: Request): Request {
  const url = new URL(request.url);

  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (protocol) url.protocol = protocol;

  const host = request.headers.get('host');
  if (host) url.host = host;

  url.port = '';

  return new Request(url, request);
}
