/**
 * Runs the built script under Deno, the runtime bunny.net runs it on, for
 * `astro preview`. Started by `preview.ts` with the script, the client folder,
 * a hostname and a port.
 *
 * Outside bunny.net the edge script SDK serves the pull zone itself, on
 * 127.0.0.1:8080, with `https://bunny.net` as its origin when the script names
 * none. This file binds that server where Astro asked for it, adds the headers
 * bunny.net sets on every request, and answers the origin's requests from the
 * client folder, the way the storage zone answers them.
 */
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

type ServeHandler = (
  request: Request,
  info: { remoteAddr: { hostname: string } },
) => Response | Promise<Response>;

declare const Deno: {
  args: string[];
  stdin: { readable: ReadableStream<Uint8Array> };
  exit(code?: number): never;
  readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
  stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean }>;
  serve(
    options: { port: number; hostname: string; onListen?: () => void },
    handler: ServeHandler,
  ): unknown;
};

const [script, clientDir, hostname, port] = Deno.args;
if (!script || !clientDir || !hostname || !port) {
  throw new Error("Usage: run-script.ts <script> <client dir> <hostname> <port>");
}

// The origin the SDK falls back to when the script names none.
const SDK_ORIGIN = "bunny.net";

// Storage sets these itself. The script gives other extensions their type.
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function readStored(
  path: string,
): Promise<{ body: Uint8Array<ArrayBuffer>; type: string } | undefined> {
  const file = normalize(join(clientDir!, decodeURIComponent(path)));
  if (!file.startsWith(clientDir!)) return undefined;

  try {
    const info = await Deno.stat(file);
    if (info.isDirectory) return await readStored(join(path, "index.html"));
    if (!info.isFile) return undefined;
    const type = CONTENT_TYPES[extname(file)] ?? "application/octet-stream";
    return { body: await Deno.readFile(file), type };
  } catch {
    return undefined;
  }
}

/**
 * Answers like the pull zone in front of the storage zone: a folder answers
 * its `index.html`, and a missing file the prerendered 404 page with 404, as
 * the storage zone's `Custom404FilePath` does.
 */
async function fromStorage(request: Request): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const { pathname } = new URL(request.url);
  const stored = await readStored(pathname);
  const notFound = stored ? undefined : await readStored("/404.html");
  const file = stored ?? notFound;

  return new Response(request.method === "HEAD" ? null : (file?.body ?? null), {
    status: stored ? 200 : 404,
    headers: file ? { "content-type": file.type } : {},
  });
}

const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const request = new Request(input, init);
  if (new URL(request.url).hostname === SDK_ORIGIN) return fromStorage(request);
  return nativeFetch(request);
};

const nativeServe = Deno.serve.bind(Deno);
Deno.serve = (_options, handler) =>
  nativeServe(
    {
      hostname: hostname!,
      port: Number(port),
      // preview.ts waits for this line before it reports the server as started.
      onListen: () => console.log("ready"),
    },
    (request, info) => {
      const headers = new Headers(request.headers);
      headers.set("x-forwarded-proto", "http");
      headers.set("x-real-ip", info.remoteAddr.hostname);
      return handler(new Request(request, { headers }), info);
    },
  );

// `astro preview stop` ends the Node process without stopping this one, which
// kept the port. Its end closes stdin.
void Deno.stdin.readable.pipeTo(new WritableStream()).finally(() => Deno.exit());

await import(pathToFileURL(script).href);

// Set only after the import: with a `Bunny` global the SDK registers its hooks
// with bunny.net instead of serving them, and `renderApp` calls
// `Bunny.v1.waitUntil` at runtime.
Object.assign(globalThis, {
  Bunny: {
    v1: {
      waitUntil: (promise: Promise<unknown>) => promise.catch(console.error),
    },
  },
});
