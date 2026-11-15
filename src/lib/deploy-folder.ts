// An edge rule serves a release from `/deploys/<id>` in storage and names it in this header; the script sees the prefixed path.
const deployHeader = "x-bunny-deploy";

export function removeDeployFolder(request: Request): {
  request: Request;
  folder: string;
} {
  const id = request.headers.get(deployHeader);
  const url = new URL(request.url);
  const folder = id ? `/deploys/${id}` : "";

  if (!folder || !url.pathname.startsWith(`${folder}/`)) {
    return { request, folder: "" };
  }

  url.pathname = url.pathname.slice(folder.length).replace(/^\/+/, "/");
  return { request: new Request(url, request), folder };
}

export function addDeployFolder(request: Request, folder: string): Request {
  if (!folder) return request;

  const url = new URL(request.url);
  url.pathname = `${folder}${url.pathname}`;
  return new Request(url, request);
}
