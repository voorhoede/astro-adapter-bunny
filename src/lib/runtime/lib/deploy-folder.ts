// An edge rule serves a release from `/deploys/<id>` in storage and names it in this header; the script sees the prefixed path.
const deployHeader = "x-bunny-deploy";

export function removeDeployFolder(request: Request): {
  request: Request;
  folder: string;
} {
  const id = request.headers.get(deployHeader);
  const url = new URL(request.url);
  const folder = id ? `/deploys/${id}` : assetPrefix();
  if (!folder) return { request, folder: "" };

  if (!url.pathname.startsWith(`${folder}/`)) {
    return { request, folder: id ? "" : folder };
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

// bunny.net's CLI deploys into a folder without edge rules, and names it in a line it puts at the top of the script.
function assetPrefix(): string {
  const deploy: unknown = Reflect.get(globalThis, "__BUNNY_DEPLOY__");
  const prefix =
    typeof deploy === "object" && deploy !== null
      ? Reflect.get(deploy, "assetPrefix")
      : undefined;
  if (typeof prefix !== "string") return "";

  const folder = prefix.replace(/^\/+|\/+$/g, "");
  return folder ? `/${folder}` : "";
}
