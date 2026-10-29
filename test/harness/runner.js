// Runs under Deno, the runtime bunny.net uses: loads one script and answers the paths passed after it.
const [script, ...paths] = Deno.args;
let handler;
let unpacked = 0;

const NativeDecompressionStream = globalThis.DecompressionStream;
globalThis.DecompressionStream = class extends NativeDecompressionStream {
  constructor(format) {
    super(format);
    unpacked++;
  }
};
globalThis.Bunny = { v1: { serve: (fetch) => (handler = fetch) } };

const run = { loaded: false, unpackedOnLoad: 0, responses: [] };
try {
  await import(new URL(script, 'file://').href);
  run.loaded = handler !== undefined;
} catch (error) {
  run.error = String(error?.stack ?? error);
}
run.unpackedOnLoad = unpacked;

// Requests run one after another, as later ones check what earlier ones left loaded.
for (const path of run.loaded ? paths : []) {
  const before = unpacked;
  // oxlint-disable-next-line no-await-in-loop
  const response = await handler(new Request(new URL(path, 'https://example.com')));
  run.responses.push({
    status: response.status,
    // oxlint-disable-next-line no-await-in-loop
    body: await response.text(),
    unpacked: unpacked - before,
  });
}

console.log(JSON.stringify(run));
