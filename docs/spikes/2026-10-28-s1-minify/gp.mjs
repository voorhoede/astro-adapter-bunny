// usage: node gp.mjs <public url> <location>[,<location>...] <rounds> <probes per location> [extra query] >> results.jsonl
// Runs <rounds> anonymous Globalping HTTP measurements one after another, each with a fresh `r` query
// (and a fresh `bust` value when the extra query contains `bust=*`). Prints one JSON line per probe result.
// Sends GLOBALPING_TOKEN as a bearer token when it is set, for the authenticated hourly limit, and waits out a 429.
const [target, locations, rounds = '1', limit = '1', extra = ''] = process.argv.slice(2);
const url = new URL(target);
const api = 'https://api.globalping.io/v1/measurements';
const label = `${url.hostname.split('.')[0]}${extra ? `?${extra}` : ''}`;

for (let round = 0; round < Number(rounds); round++) {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const query = [url.search.slice(1), `r=${nonce}`, extra.replace('bust=*', `bust=${nonce}`)].filter(Boolean).join('&');
  const create = () => fetch(api, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(process.env.GLOBALPING_TOKEN && { authorization: `Bearer ${process.env.GLOBALPING_TOKEN}` }) },
    body: JSON.stringify({
      type: 'http',
      target: url.hostname,
      locations: locations.split(',').map((magic) => ({ magic, limit: Number(limit) })),
      measurementOptions: { protocol: 'HTTPS', request: { method: 'GET', path: url.pathname, query } },
    }),
  });
  let response = await create();
  while (response.status === 429) {
    const wait = Number(response.headers.get('x-ratelimit-reset') ?? 60);
    console.error(`globalping rate limit, waiting ${wait} s`);
    await new Promise((resolve) => setTimeout(resolve, (wait + 5) * 1000));
    response = await create();
  }
  const created = await response.json();
  if (!response.ok) { console.error('globalping error', response.status, JSON.stringify(created)); process.exit(1); }
  let result;
  for (let i = 0; i < 90; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    result = await (await fetch(`${api}/${created.id}`)).json();
    if (result.status !== 'in-progress') break;
  }
  for (const { probe, result: r } of result.results) {
    let body = {};
    try { body = JSON.parse(r.rawBody) ?? { raw: null }; } catch { body = { raw: (r.rawBody ?? '').slice(0, 120) }; }
    console.log(JSON.stringify({
      label, round, probeStatus: r.status, city: probe.city, country: probe.country, status: r.statusCode,
      ttfb: r.timings?.firstByte, total: r.timings?.total, tls: r.timings?.tls, tcp: r.timings?.tcp, ...body,
    }));
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
