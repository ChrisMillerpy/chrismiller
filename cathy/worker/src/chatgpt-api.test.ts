import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, type ApiEnv } from './api.ts';
import { Vault } from './chatgpt-vault.ts';
import { fakeD1, fakeR2, jwt, SCHEMA } from './test-fakes.ts';

const AUTH = 'https://api.openai.com/auth';
const ACCESS = jwt({ [AUTH]: { chatgpt_account_id: 'acct_1' }, n: 'access-1' });
const SECRETS = ['refresh-1', ACCESS, 'acct_1'];

function setup(backendReply?: () => Response) {
  const data = new Map<string, unknown>();
  const kv = { get: async (k: string) => data.get(k) as any, put: async (k: string, v: unknown) => void data.set(k, v), delete: async (k: string) => data.delete(k) };
  const oauth = async () => new Response(JSON.stringify({ access_token: ACCESS, refresh_token: 'refresh-1', id_token: jwt({ email: 'c@example.com', [AUTH]: { chatgpt_plan_type: 'plus' } }), expires_in: 3600 }));
  const vault = new Vault(kv as any, oauth as any);
  const sent: any[] = [];
  const env = {
    DB: fakeD1(),
    FILES: fakeR2(),
    MODEL: 'claude-opus-5-5',
    MODELS: 'claude-opus-5-5=Opus,gpt-6-astra=Astra API,chatgpt/gpt-6-astra=Astra plan,chatgpt/gpt-6.1-sol=Sol plan',
    SESSION: { getByName: () => ({}) },
    CHATGPT: { getByName: () => vault },
    fetchImpl: async (url: any, init: any) => {
      sent.push({ url: String(url), body: JSON.parse(init.body), auth: new Headers(init.headers).get('authorization') });
      return backendReply?.() ?? new Response('data: {"type":"response.output_text.delta","delta":"read"}\n\ndata: {"type":"response.output_text.delta","delta":"y"}\n\ndata: {"type":"response.completed"}\n\n', { status: 200 });
    },
  } as unknown as ApiEnv;
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
    handle(new Request(`https://cathy.internal${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers }), env, SCHEMA);
  return { call, sent, data };
}
async function connect(call: ReturnType<typeof setup>['call']) {
  const { url } = await (await call('POST', '/api/chatgpt/start', {})).json();
  const state = new URL(url).searchParams.get('state');
  return call('POST', '/api/chatgpt/finish', { input: `http://localhost:1455/auth/callback?code=abc&state=${state}` });
}

test('chatgpt: status, start, finish, disconnect, and no route ever returns a token or the account id', async () => {
  const { call } = setup();
  const seen: string[] = [];
  const keep = async (r: Response) => (seen.push(JSON.stringify(await r.clone().json())), r);

  let r = await keep(await call('GET', '/api/chatgpt'));
  assert.deepEqual(await r.json(), { connected: false, models: ['chatgpt/gpt-6-astra', 'chatgpt/gpt-6.1-sol'] });
  r = await keep(await call('POST', '/api/chatgpt/start', {}));
  assert.match((await r.json()).url, /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/);
  r = await keep(await connect(call));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { connected: true, email: 'c@example.com', plan: 'plus' });
  r = await keep(await call('GET', '/api/chatgpt'));
  assert.equal((await r.json()).connected, true);
  r = await keep(await call('POST', '/api/chatgpt/test', {}));
  r = await keep(await call('DELETE', '/api/chatgpt'));
  assert.equal(r.status, 200);
  assert.equal((await (await call('GET', '/api/chatgpt')).json()).connected, false);
  for (const text of seen) for (const secret of SECRETS) assert.ok(!text.includes(secret), `${secret.slice(0, 12)}… leaked`);
});

test('chatgpt: a wrong or missing pasted address is a 400 with a reason, not a crash', async () => {
  const { call } = setup();
  await call('POST', '/api/chatgpt/start', {});
  const bad = await call('POST', '/api/chatgpt/finish', { input: 'http://localhost:1455/auth/callback?code=abc&state=nope' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /doesn't match/);
  assert.equal((await call('POST', '/api/chatgpt/finish', {})).status, 400);
});

test('chatgpt: changing anything needs JSON, so a form posted from another site does nothing', async () => {
  const { call } = setup();
  for (const path of ['/api/chatgpt/start', '/api/chatgpt/finish', '/api/chatgpt/test']) {
    assert.equal((await call('POST', path, { input: 'x' }, { 'content-type': 'text/plain' })).status, 415, path);
  }
  assert.equal((await call('POST', '/api/chatgpt/start', {}, { 'content-type': 'application/x-www-form-urlencoded' })).status, 415);
});

test('chatgpt test: sends one small request on the plan and reports the reply', async () => {
  const { call, sent } = setup();
  const notYet = await (await call('POST', '/api/chatgpt/test', {})).json();
  assert.equal(notYet.ok, false);
  assert.match(notYet.error, /isn't connected/);
  assert.equal(sent.length, 0);

  await connect(call);
  const r = await (await call('POST', '/api/chatgpt/test', { model: 'chatgpt/gpt-6.1-sol' })).json();
  assert.deepEqual(r, { ok: true, model: 'chatgpt/gpt-6.1-sol', reply: 'ready' });
  assert.equal(sent[0].url, 'https://chatgpt.com/backend-api/codex/responses');
  assert.equal(sent[0].body.model, 'gpt-6.1-sol');
  assert.equal(sent[0].auth, `Bearer ${ACCESS}`);
});

test('chatgpt test: what ChatGPT said is shown when it refuses, and only plan models can be tested', async () => {
  const { call } = setup(() => new Response(JSON.stringify({ detail: "The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account." }), { status: 400 }));
  await connect(call);
  const r = await (await call('POST', '/api/chatgpt/test', {})).json();
  assert.equal(r.ok, false);
  assert.match(r.error, /400/);
  assert.match(r.error, /not supported when using Codex/);
  assert.equal((await call('POST', '/api/chatgpt/test', { model: 'gpt-6-astra' })).status, 400, 'an API model is not a plan model');
  assert.equal((await call('POST', '/api/chatgpt/test', { model: 'chatgpt/nope' })).status, 400, 'nor one outside the list');
});
