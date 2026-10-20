import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.ts';

const SECRET = 'k3y-0f-at-least-thirty-two-chars-long-xx';

function setup(secret: string | undefined = SECRET, answer = () => Response.json({ ok: true, posted: true })) {
  const seen: { url: string; method: string; body: string; headers: Record<string, string> }[] = [];
  const env = {
    MONZO_WEBHOOK_SECRET: secret,
    CATHY: {
      fetch: async (r: Request) => {
        seen.push({ url: r.url, method: r.method, body: await r.text(), headers: Object.fromEntries(r.headers) });
        return answer();
      },
    },
  } as any;
  const send = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`https://money.test${path}`, init), env);
  return { seen, send };
}
const body = JSON.stringify({ type: 'transaction.created', data: { id: 'tx_1', amount: -420 } });

test('a POST to /monzo/<secret> is forwarded to Cathy as JSON, with nothing else', async () => {
  const { seen, send } = setup();
  const r = await send(`/monzo/${SECRET}?x=1`, { method: 'POST', body, headers: { 'content-type': 'application/json', cookie: 'a=b', authorization: 'Bearer z' } });
  assert.equal(r.status, 200);
  assert.deepEqual(seen, [{ url: 'https://cathy.internal/money/monzo', method: 'POST', body, headers: { 'content-type': 'application/json' } }]);
});

test('a wrong or missing secret is refused before Cathy sees it', async () => {
  const { seen, send } = setup();
  for (const p of ['/', '/monzo', '/monzo/', `/monzo/${SECRET}x`, `/monzo/${SECRET.slice(0, -1)}`, `/monzo/${SECRET}/extra`, `/api/sessions`, `/money/monzo`]) {
    assert.equal((await send(p, { method: 'POST', body })).status, 404, p);
  }
  assert.equal((await send(`/monzo/${SECRET}`)).status, 405);
  assert.deepEqual(seen, []);
});

test('without a secret set (or a short one), nothing gets through', async () => {
  for (const s of [undefined, '', 'short']) {
    const { seen, send } = setup(s);
    assert.equal((await send(`/monzo/${s ?? ''}`, { method: 'POST', body })).status, 404);
    assert.equal((await send('/monzo/undefined', { method: 'POST', body })).status, 404);
    assert.deepEqual(seen, []);
  }
});

test('big bodies are refused', async () => {
  const { seen, send } = setup();
  const r = await send(`/monzo/${SECRET}`, { method: 'POST', body: 'x'.repeat(70_000) });
  assert.equal(r.status, 413);
  assert.deepEqual(seen, []);
});

test("Cathy's answer status is passed back (so Monzo retries real failures)", async () => {
  const { send } = setup(SECRET, () => new Response('boom', { status: 500 }));
  assert.equal((await send(`/monzo/${SECRET}`, { method: 'POST', body })).status, 500);
});

test('robots are told to stay away', async () => {
  const { send } = setup();
  assert.match(await (await send('/robots.txt')).text(), /Disallow: \//);
});
