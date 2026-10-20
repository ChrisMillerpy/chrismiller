// The public money Worker. Monzo calls it on every transaction on Chris's account (a webhook).
// Anyone on the internet can reach it, so it does one thing: a POST to /monzo/<secret> is passed
// to the private Cathy Worker as POST /money/monzo. Monzo doesn't sign its webhooks, so the
// secret in the URL is the lock. Every other path, method or secret is refused here, before
// Cathy sees it. It stores nothing.

interface Env {
  CATHY: Fetcher;
  /** The secret part of the webhook URL. At least 32 characters. Set with `wrangler secret put`. */
  MONZO_WEBHOOK_SECRET?: string;
}

const MAX_BODY = 64 * 1024;
const enc = new TextEncoder();

/** Compares in constant time, so the secret can't be guessed a character at a time. */
function same(a: string, b: string) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const text = (body: string, status: number, headers: Record<string, string> = {}) => new Response(body, { status, headers: { 'content-type': 'text/plain', 'x-robots-tag': 'noindex', ...headers } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/robots.txt') return text('User-agent: *\nDisallow: /\n', 200);
    const m = url.pathname.match(/^\/monzo\/([^/]+)$/);
    const secret = env.MONZO_WEBHOOK_SECRET ?? '';
    if (!m || secret.length < 32 || !same(m[1], secret)) return text('Not found', 404);
    if (request.method !== 'POST') return text('POST only', 405, { allow: 'POST' });

    const body = await request.text();
    if (body.length > MAX_BODY) return text('Too big', 413);
    // Only the body goes through: no query string, no cookies, no other headers.
    const res = await env.CATHY.fetch(new Request('https://cathy.internal/money/monzo', { method: 'POST', body, headers: { 'content-type': 'application/json' } }));
    return text(res.ok ? 'ok' : 'error', res.status);
  },
} satisfies ExportedHandler<Env>;
