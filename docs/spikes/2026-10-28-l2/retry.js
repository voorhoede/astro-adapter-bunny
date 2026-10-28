const sources = {
  'https://parts.test/a.js': "System.register([], function (e) { return { execute: function () { e('v', 'a'); } }; });",
  'https://parts.test/b.js': "System.register([], function (e) { return { execute: function () { e('v', 'b'); } }; });",
};
const fetches = [];
let failNext = true;
const proto = System.constructor.prototype;
proto.shouldFetch = () => true;
proto.fetch = async (url) => {
  fetches.push(url.slice(-4));
  await new Promise((r) => setTimeout(r, 20));
  if (url.endsWith('a.js') && failNext) { failNext = false; return new Response('', { status: 503 }); }
  return new Response(sources[url], { headers: { 'content-type': 'application/javascript' } });
};
const out = {};
try { await System.import('https://parts.test/a.js'); out.first = 'ok'; } catch (e) { out.first = `failed: ${e.message.slice(0, 60)}`; }
try { out.retry = (await System.import('https://parts.test/a.js')).v; } catch (e) { out.retry = `failed again: ${e.message.slice(0, 60)}`; }
out.fetchesAfterRetry = [...fetches];
const [x, y] = await Promise.all([System.import('https://parts.test/b.js'), System.import('https://parts.test/b.js')]);
out.concurrent = `${x.v}${y.v}`;
out.bFetches = fetches.filter((f) => f === 'b.js').length;
const registryDelete = typeof System.delete;
out.deleteSupported = registryDelete;
console.log(JSON.stringify(out));
