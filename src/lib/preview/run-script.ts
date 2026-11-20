/**
 * Runs the built script under Deno, the runtime bunny.net runs it on, for
 * `astro preview`. Started by `preview.ts` with the script, the client folder,
 * a hostname and a port.
 *
 * The script registers its hooks with bunny.net through a `Bunny` global. This
 * file provides that global, hands the hooks to the edge script SDK's own pull
 * zone handler, and serves it where Astro asked for it, with a stand-in for the
 * storage zone as its origin.
 */
import { net } from "@bunny.net/edgescript-sdk";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

type Middlewares = Parameters<typeof net.http.internal_buildPullZoneHandler>[1];

declare const Deno: {
  args: string[];
  stdin: { readable: ReadableStream<Uint8Array> };
  exit(code?: number): never;
  readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
  stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean }>;
  serve(
    options: {
      port: number;
      hostname: string;
      onListen?: (addr: { port: number }) => void;
    },
    handler: (
      request: Request,
      info: { remoteAddr: { hostname: string } },
    ) => Response | Promise<Response>,
  ): unknown;
};

const [script, clientDir, hostname, port] = Deno.args;
if (!script || !clientDir || !hostname || !port) {
  throw new Error("Usage: run-script.ts <script> <client dir> <hostname> <port>");
}

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

const storageOrigin = await new Promise<string>((resolve) => {
  Deno.serve(
    {
      hostname: "127.0.0.1",
      port: 0,
      onListen: (addr) => resolve(`http://127.0.0.1:${addr.port}`),
    },
    fromStorage,
  );
});

let middlewares: Middlewares | undefined;
Object.assign(globalThis, {
  Bunny: {
    v1: {
      registerMiddlewares: (registered: Middlewares) => {
        middlewares = registered;
      },
      waitUntil: (promise: Promise<unknown>) => promise.catch(console.error),
    },
  },
});

await import(pathToFileURL(script).href);
if (!middlewares) throw new Error(`${script} registered no pull zone hooks.`);

const pullZone = net.http.internal_buildPullZoneHandler(
  storageOrigin,
  middlewares,
  "deno",
);

Deno.serve(
  {
    hostname,
    port: Number(port),
    // preview.ts waits for this line before it reports the server as started.
    onListen: () => console.log("ready"),
  },
  (request, info) => {
    const headers = new Headers(request.headers);
    headers.set("x-forwarded-proto", "http");
    headers.set("x-real-ip", info.remoteAddr.hostname);
    return pullZone(new Request(request, { headers }));
  },
);

// `astro preview stop` ends the Node process without stopping this one, which
// kept the port. Its end closes stdin.
void Deno.stdin.readable.pipeTo(new WritableStream()).finally(() => Deno.exit());
