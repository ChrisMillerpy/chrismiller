import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, type ApiEnv } from './api.ts';
import { Registry } from './registry.ts';
import { fakeD1, fakeR2, SCHEMA } from './test-fakes.ts';

function setup() {
  const changes: any[] = [];
  const env: ApiEnv = {
    DB: fakeD1(),
    FILES: fakeR2(),
    MODEL: 'claude-opus-5-5',
    MODELS: 'claude-opus-5-5=Opus,claude-sonnet-5-5=Sonnet',
    SHARE_URL: 'https://share.test',
    SESSION: { getByName: () => ({ fetch: async () => new Response('ws'), changed: async (_id, e) => void changes.push(e) }) },
  } as any;
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    handle(new Request(`https://cathy.internal${path}`, { method, body: body instanceof Uint8Array ? body : body === undefined ? undefined : JSON.stringify(body), headers }), env, SCHEMA);
  const registry = () => new Registry(env.DB, SCHEMA, env.FILES);
  return { env, call, changes, registry };
}
const enc = (s: string) => new TextEncoder().encode(s);

test('sessions: create with defaults, rename, change model, archive and unarchive', async () => {
  const { call, changes } = setup();
  const s = await (await call('POST', '/api/sessions', {})).json();
  assert.equal(s.model, 'claude-opus-5-5');
  assert.equal(s.effort, 'medium');

  const renamed = await (await call('PATCH', `/api/sessions/${s.id}`, { title: 'My chat' })).json();
  assert.equal(renamed.title, 'My chat');
  assert.equal(renamed.named_by, 'chris');
  const changed = await (await call('PATCH', `/api/sessions/${s.id}`, { model: 'claude-sonnet-5-5', effort: 'high' })).json();
  assert.equal(changed.model, 'claude-sonnet-5-5');
  assert.equal(changed.effort, 'high');
  assert.deepEqual(changes, [{ type: 'title', title: 'My chat' }, { type: 'settings', model: 'claude-sonnet-5-5', effort: 'high' }]);

  assert.equal((await call('PATCH', `/api/sessions/${s.id}`, { model: 'gpt-9' })).status, 400);
  assert.equal((await call('PATCH', `/api/sessions/${s.id}`, { title: '  ' })).status, 400);

  await call('POST', `/api/sessions/${s.id}/archive`);
  assert.equal((await (await call('GET', '/api/sessions')).json()).length, 0);
  assert.equal((await (await call('GET', '/api/sessions?status=archived')).json()).length, 1);
  await call('POST', `/api/sessions/${s.id}/unarchive`);
  assert.equal((await (await call('GET', '/api/sessions')).json()).length, 1);
});

test('models endpoint lists the choices and defaults', async () => {
  const { call } = setup();
  const m = await (await call('GET', '/api/models')).json();
  assert.deepEqual(m.models.map((x: any) => x.id), ['claude-opus-5-5', 'claude-sonnet-5-5']);
  assert.deepEqual(m.defaults, { model: 'claude-opus-5-5', effort: 'medium' });
});

test('uploads: stored, served back to their own chat only, size-limited', async () => {
  const { call } = setup();
  const a = await (await call('POST', '/api/sessions', {})).json();
  const b = await (await call('POST', '/api/sessions', {})).json();
  const u = await (await call('POST', `/api/sessions/${a.id}/uploads`, new Uint8Array([1, 2, 3]), { 'x-filename': encodeURIComponent('graph 1.png'), 'content-type': 'image/png' })).json();
  assert.equal(u.name, 'graph 1.png');
  assert.equal(u.mime, 'image/png');
  const back = await call('GET', `/api/sessions/${a.id}/uploads/${u.id}`);
  assert.deepEqual(new Uint8Array(await back.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.match(back.headers.get('content-security-policy')!, /^sandbox/);
  assert.equal((await call('GET', `/api/sessions/${b.id}/uploads/${u.id}`)).status, 404, 'not from another chat');
  const big = await call('POST', `/api/sessions/${a.id}/uploads`, new Uint8Array(26 * 1024 * 1024), { 'x-filename': 'big.bin' });
  assert.equal(big.status, 413);
});

test('artifacts: admin can list, read, rename, share, re-link and delete; the token never leaks except in share_url', async () => {
  const { call, registry } = setup();
  const s = await (await call('POST', '/api/sessions', { title: 'Worksheets' })).json();
  const a = await registry().publish({ session_id: s.id, title: 'Fractions', filename: 'f.html', mime: 'text/html; charset=utf-8' }, enc('<h1>½</h1>'));

  const list = await (await call('GET', '/api/artifacts')).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].session_title, 'Worksheets');
  assert.equal(list[0].token, undefined);
  assert.equal(list[0].share_url, `https://share.test/a/${a.token}`);

  const one = await (await call('GET', `/api/artifacts/${a.id}`)).json();
  assert.deepEqual(one.versions.map((v: any) => v.version), [1]);

  const raw = await call('GET', `/api/artifacts/${a.id}/raw`);
  assert.equal(await raw.text(), '<h1>½</h1>');
  assert.match(raw.headers.get('content-security-policy')!, /^sandbox allow-scripts/);
  assert.doesNotMatch(raw.headers.get('content-security-policy')!, /allow-same-origin/);

  const shared = await (await call('PATCH', `/api/artifacts/${a.id}`, { visibility: 'link', title: 'Fractions 1' })).json();
  assert.equal(shared.visibility, 'link');
  assert.equal(shared.title, 'Fractions 1');
  assert.equal((await call('PATCH', `/api/artifacts/${a.id}`, { visibility: 'public' })).status, 400);

  const relinked = await (await call('POST', `/api/artifacts/${a.id}/new-link`)).json();
  assert.notEqual(relinked.share_url, shared.share_url);
  assert.equal((await call('DELETE', `/api/artifacts/${a.id}`)).status, 200);
  assert.equal((await call('GET', `/api/artifacts/${a.id}`)).status, 404);
});

test('share: serves only link artifacts by token; private, wrong, old tokens and everything else are 404', async () => {
  const { call, registry } = setup();
  const r = registry();
  const s = await r.create('');
  const priv = await r.publish({ session_id: s.id, title: 'Private', filename: 'p.html', mime: 'text/html' }, enc('secret'));
  const pub = await r.publish({ session_id: s.id, title: 'Shared', filename: 's.html', mime: 'text/html', visibility: 'link' }, enc('hello'));

  const ok = await call('GET', `/share/a/${pub.token}`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'hello');
  assert.equal(ok.headers.get('cache-control'), 'public, max-age=60');
  assert.match(ok.headers.get('content-security-policy')!, /^sandbox/);
  assert.match((await call('GET', `/share/a/${pub.token}/download`)).headers.get('content-disposition')!, /^attachment/);

  assert.equal((await call('GET', `/share/a/${priv.token}`)).status, 404, 'private');
  assert.equal((await call('GET', '/share/a/aaaaaaaaaaaaaaaaaaaa')).status, 404, 'wrong token');
  assert.equal((await call('GET', `/share/a/${pub.token}/raw`)).status, 404);
  assert.equal((await call('GET', `/share/a/${pub.token}/download/x`)).status, 404);
  assert.equal((await call('GET', '/share/public')).status, 404, 'no listing');
  assert.equal((await call('POST', `/share/a/${pub.token}`)).status, 405);
  assert.equal((await call('GET', '/share/a/%E0%A4%A')).status, 404, 'bad encoding');

  await r.publish({ session_id: s.id, title: 'Shared', filename: 's.html', mime: 'text/html', id: pub.id }, enc('hello v2'));
  assert.equal(await (await call('GET', `/share/a/${pub.token}`)).text(), 'hello v2', 'link serves the latest version');

  await r.newLink(pub.id);
  assert.equal((await call('GET', `/share/a/${pub.token}`)).status, 404, 'old link dead');
});

test('Markdown artifacts are served as a rendered page with maths, and the Markdown cannot break out', async () => {
  const { call, registry } = setup();
  const r = registry();
  const s = await r.create('');
  const md = '# Sheet\n\nSolve $x^2 = 4$.\n\n</script><script>alert(1)</script>';
  const a = await r.publish({ session_id: s.id, title: 'Sheet', filename: 'sheet.md', mime: 'text/markdown; charset=utf-8', visibility: 'link' }, enc(md));
  const page = await (await call('GET', `/share/a/${a.token}`)).text();
  assert.match(page, /katex/);
  assert.match(page, /<title>Sheet<\/title>/);
  assert.equal(page.match(/<\/script><script>alert/g), null, 'the Markdown is escaped inside the page');
  const rawMd = await call('GET', `/share/a/${a.token}/download`);
  assert.equal(await rawMd.text(), md);
});

test('money: a Monzo webhook (forwarded by the money Worker) is stored and posted to the Money chat', async () => {
  const { env, call, registry } = setup();
  const posted: any[] = [];
  env.SESSION = { getByName: (id: string) => ({ fetch: async () => new Response(), changed: async () => {}, receiveMoney: async (myId: string, text: string, reply: boolean) => void posted.push({ id, myId, text, reply }) }) } as any;
  const body = { type: 'transaction.created', data: { id: 'tx_1', amount: -420, currency: 'GBP', created: '2026-10-21T08:15:00Z', description: 'PRET', category: 'eating_out', merchant: { name: 'Pret A Manger' }, metadata: {} } };
  const r = await call('POST', '/money/monzo', body, { 'content-type': 'application/json' });
  assert.equal(r.status, 200);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].id, posted[0].myId);
  assert.equal((await registry().get(posted[0].id))!.title, 'Money');
  assert.match(posted[0].text, /Pret A Manger/);
  assert.equal((await call('POST', '/money/monzo', body, { 'content-type': 'application/json' })).status, 200, 'retries are fine');
  assert.equal(posted.length, 1, 'but not posted twice');
});

test('money: junk gets a 400, and only POST works', async () => {
  const { call } = setup();
  assert.equal((await call('POST', '/money/monzo', { type: 'transaction.created', data: { id: 3 } }, { 'content-type': 'application/json' })).status, 400);
  assert.equal((await call('POST', '/money/monzo', 'not json', { 'content-type': 'application/json' })).status, 400);
  assert.equal((await call('GET', '/money/monzo')).status, 404);
});
