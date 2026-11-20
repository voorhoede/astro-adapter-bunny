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
import { serveDir } from "@std/http/file-server";
import { pathToFileURL } from "node:url";

type Middlewares = Parameters<typeof net.http.internal_buildPullZoneHandler>[1];

declare const Deno: {
  args: string[];
  stdin: { readable: ReadableStream<Uint8Array> };
  exit(code?: number): never;
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

const fromDir = (request: Request) =>
  serveDir(request, { fsRoot: clientDir, quiet: true });

/**
 * Answers like the pull zone in front of the storage zone: a folder answers
 * its `index.html` with or without its trailing slash, and a missing file the
 * prerendered 404 page with 404, as the storage zone's `Custom404FilePath`
 * does.
 */
async function fromStorage(request: Request): Promise<Response> {
  let response = await fromDir(request);

  if (response.status === 301) {
    const location = response.headers.get("location")!;
    response = await fromDir(new Request(location, request));
  }

  if (response.status === 404) {
    const page = await fromDir(
      new Request(new URL("/404.html", request.url), { method: request.method }),
    );
    response = new Response(page.ok ? page.body : null, {
      status: 404,
      headers: page.ok ? page.headers : {},
    });
  }

  return response;
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
