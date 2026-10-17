// The public share Worker. Anyone on the internet can reach it, so it does one thing:
// GET or HEAD /a/<token> (or /a/<token>/download) is passed to the private Cathy Worker,
// which answers only for artifacts set to "anyone with the link". Every other path and
// method is refused here, before Cathy sees it.

interface Env {
  CATHY: Fetcher;
}

const TOKEN = /^\/a\/([a-z0-9]{20})(\/download)?\/?$/;

const page = (title: string, text: string, status: number) =>
  new Response(
    `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#FAFBFD;color:#18203A;font:17px/1.5 system-ui,sans-serif;text-align:center;padding:24px}
@media (prefers-color-scheme:dark){body{background:#0B1222;color:#E8EDF8}}h1{font:600 28px Georgia,serif;margin:0 0 8px}p{margin:0;opacity:.75}</style></head>
<body><div><h1>${title}</h1><p>${text}</p></div></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60', 'x-robots-tag': 'noindex' } },
  );

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Read only', { status: 405, headers: { allow: 'GET, HEAD' } });
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
    const m = url.pathname.match(TOKEN);
    if (!m) return page('Nothing here', 'This address does not point to anything.', 404);
    // Only the token and the download flag go through: no query string, no cookies, no other headers.
    const target = new URL(`https://cathy.internal/share/a/${m[1]}${m[2] ?? ''}`);
    const res = await env.CATHY.fetch(new Request(target, { method: request.method }));
    if (res.status === 404) return page('Link not found', 'This link has expired or was turned off. Ask Chris for a new one.', 404);
    const headers = new Headers(res.headers);
    headers.set('x-robots-tag', 'noindex');
    return new Response(res.body, { status: res.status, headers });
  },
} satisfies ExportedHandler<Env>;
