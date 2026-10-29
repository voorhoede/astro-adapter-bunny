// Inlined into the script after SystemJS by build/bundle; it is never imported.
(function startPacked({ entry, builtins, inline, packed, wasm, wasmOf }) {
  const base = 'https://script.invalid/';
  const utf8 = new TextDecoder();
  const unpack = async (data) =>
    new Uint8Array(
      await new Response(
        new Blob([Uint8Array.fromBase64(data)])
          .stream()
          .pipeThrough(new DecompressionStream('brotli')),
      ).arrayBuffer(),
    );

  globalThis.__bunnyWasm = [];
  globalThis.__bunnyRequire = (id) => {
    const module = builtins[id.startsWith('node:') ? id : `node:${id}`];
    if (!module)
      throw new Error(`${id} is required at runtime, and the script holds no such builtin.`);
    return module.default ?? module;
  };
  const loader = System.constructor.prototype;
  loader.resolve = (id, parent) => (id in builtins ? id : new URL(id, parent ?? base).href);
  loader.instantiate = function (url) {
    if (url in builtins) {
      return [
        [],
        (_export) => ({
          // SystemJS awaits a value returned from execute, so this returns nothing.
          execute() {
            _export(builtins[url]);
          },
        }),
      ];
    }
    const name = url.slice(base.length);
    if (name in inline) {
      inline[name]();
      return this.getRegister(url);
    }
    if (!(name in packed)) throw new Error(`The script holds no server chunk ${name}.`);
    return (async () => {
      await Promise.all(
        (wasmOf[name] ?? []).map(async (id) => {
          globalThis.__bunnyWasm[id] ??= await unpack(wasm[id]);
        }),
      );
      (0, eval)(utf8.decode(await unpack(packed[name])));
      return this.getRegister(url);
    })();
  };

  let app;
  return (request) =>
    (app ??= System.import(base + entry)).then((module) => module.default.fetch(request));
});
