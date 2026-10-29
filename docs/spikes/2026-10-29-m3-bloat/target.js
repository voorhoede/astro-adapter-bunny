// The subrequest target: a tiny standalone script that answers every request with "ok".
Bunny.v1.serve(() => new Response('ok', { headers: { 'cache-control': 'no-store' } }));
