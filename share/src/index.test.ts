import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.ts';

function setup(answer = (u: string) => new Response(`file for ${u}`, { headers: { 'content-type': 'text/plain' } })) {
  const seen: { url: string; method: string; cookie: string | null }[] = [];
  const env = {
    CATHY: {
      fetch: async (r: Request) => {
        seen.push({ url: r.url, method: r.method, cookie: r.headers.get('cookie') });
        return answer(r.url);
      },
    },
  } as any;
  const get = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`https://share.test${path}`, init), env);
  return { seen, get };
}
const TOKEN = 'abcdefghijkmnpqrstuv';

test('forwards only /a/<token> and /a/<token>/download, as a bare GET', async () => {
  const { seen, get } = setup();
  const r = await get(`/a/${TOKEN}?x=1`, { headers: { cookie: 'CF_Authorization=secret' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex');
  await get(`/a/${TOKEN}/download`);
  assert.deepEqual(seen, [
    { url: `https://cathy.internal/share/a/${TOKEN}`, method: 'GET', cookie: null },
    { url: `https://cathy.internal/share/a/${TOKEN}/download`, method: 'GET', cookie: null },
  ]);
});

test('refuses everything else before Cathy sees it', async () => {
  const { seen, get } = setup();
  for (const p of ['/', '/api/sessions', '/api/cathy/sessions', '/share/a/' + TOKEN, '/a/short', `/a/${TOKEN}/raw`, `/a/${TOKEN.toUpperCase()}`, '/a/../api/sessions', `/a/${TOKEN}/../../api/artifacts`]) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
  }
  assert.equal((await get(`/a/${TOKEN}`, { method: 'POST', body: 'x' })).status, 405);
  assert.equal((await get(`/a/${TOKEN}`, { method: 'DELETE' })).status, 405);
  assert.deepEqual(seen, []);
});

test('a dead or private link gets a friendly 404 page', async () => {
  const { get } = setup(() => Response.json({ error: 'Not found' }, { status: 404 }));
  const r = await get(`/a/${TOKEN}`);
  assert.equal(r.status, 404);
  assert.match(await r.text(), /Link not found/);
});

test('robots are told to stay away', async () => {
  const { get } = setup();
  assert.match(await (await get('/robots.txt')).text(), /Disallow: \//);
});
