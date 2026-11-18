// Extensions bunny.net storage answered with application/octet-stream (measured on 2026-11-18).
const CONTENT_TYPES: Record<string, string> = {
  csv: "text/csv",
  gltf: "model/gltf+json",
  gz: "application/gzip",
  ics: "text/calendar",
  map: "application/json",
  md: "text/markdown",
  mjs: "text/javascript",
  otf: "font/otf",
  toml: "application/toml",
  ttf: "font/ttf",
  vcf: "text/vcard",
  webmanifest: "application/manifest+json",
  xsl: "application/xslt+xml",
  yaml: "application/yaml",
  yml: "application/yaml",
};

export function withContentType(
  response: Response,
  pathname: string,
): Response {
  if (response.headers.get("content-type") !== "application/octet-stream") {
    return response;
  }

  const extension = pathname.match(/\.([^./]+)$/)?.[1]?.toLowerCase();
  const type = extension && CONTENT_TYPES[extension];
  if (type) response.headers.set("content-type", type);
  return response;
}
