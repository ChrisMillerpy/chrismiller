import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vault, type KV } from './chatgpt-vault.ts';
import { jwt } from './test-fakes.ts';

const AUTH = 'https://api.openai.com/auth';
const memory = (): KV & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return { data, get: async (k: string) => data.get(k) as any, put: async (k: string, v: unknown) => void data.set(k, v), delete: async (k: string) => data.delete(k) } as any;
};
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const tokenBody = (n: number, extra: Record<string, unknown> = {}) => ({ access_token: jwt({ [AUTH]: { chatgpt_account_id: 'acct_1' }, n }), refresh_token: `refresh-${n}`, id_token: jwt({ email: 'c@example.com', [AUTH]: { chatgpt_plan_type: 'plus' } }), expires_in: 3600, ...extra });

function setup(reply: (n: number, body: URLSearchParams) => Response | Promise<Response> = (n) => ok(tokenBody(n))) {
  const kv = memory();
  let now = 1_000_000;
  const calls: URLSearchParams[] = [];
  const fetch = async (_u: any, init: any) => {
    const body = new URLSearchParams(init.body);
    calls.push(body);
    return reply(calls.length, body);
  };
  const vault = new Vault(kv, fetch as any, () => now);
  return { kv, vault, calls, advance: (ms: number) => (now += ms) };
}
async function connect(s: ReturnType<typeof setup>) {
  const { url } = await s.vault.start();
  const state = new URL(url).searchParams.get('state')!;
  return s.vault.finish(`http://localhost:1455/auth/callback?code=abc&state=${state}`);
}

test('connecting stores the sign-in and reports who, but status never contains a token', async () => {
  const s = setup();
  assert.deepEqual(await s.vault.status(), { connected: false });
  const status = await connect(s);
  assert.deepEqual(status, { connected: true, email: 'c@example.com', plan: 'plus' });
  assert.deepEqual(await s.vault.status(), status);
  const everything = JSON.stringify([status, await s.vault.status(), await s.vault.start()]);
  assert.doesNotMatch(everything, /refresh-1|eyJ/, 'no token or JWT in anything it returns');
});

test('the sign-in link is single use, expires, and only matches its own state', async () => {
  const s = setup();
  const { url } = await s.vault.start();
  const state = new URL(url).searchParams.get('state')!;
  await assert.rejects(s.vault.finish(`http://localhost:1455/auth/callback?code=abc&state=wrong`), /doesn't match/i);
  await assert.rejects(s.vault.finish(`http://localhost:1455/auth/callback?code=abc&state=${state}`), /start again/i, 'a mismatch burns the pending sign-in');
  assert.equal(s.calls.length, 0, 'nothing was sent to OpenAI');

  const t = await s.vault.start();
  const st = new URL(t.url).searchParams.get('state')!;
  await s.vault.finish(`http://localhost:1455/auth/callback?code=abc&state=${st}`);
  await assert.rejects(s.vault.finish(`http://localhost:1455/auth/callback?code=abc&state=${st}`), /start again/i, 'used once only');

  await s.vault.start();
  const late = new URL((await s.vault.start()).url).searchParams.get('state')!;
  s.advance(11 * 60_000);
  await assert.rejects(s.vault.finish(`http://localhost:1455/auth/callback?code=abc&state=${late}`), /expired|start again/i);
});

test('a result with no code, an error, or no state is refused clearly', async () => {
  const s = setup();
  await s.vault.start();
  await assert.rejects(s.vault.finish('http://localhost:1455/auth/callback?error=access_denied'), /access_denied/);
  await s.vault.start();
  await assert.rejects(s.vault.finish(''), /paste/i);
  await s.vault.start();
  await assert.rejects(s.vault.finish('just-a-code'), /state/i, 'a bare code can not be checked, so it is refused');
});

test('an access token is handed out; near expiry it is refreshed and the rotated refresh token is saved first', async () => {
  const s = setup();
  await connect(s);
  const first = await s.vault.accessToken();
  assert.equal(first.accountId, 'acct_1');
  assert.equal(s.calls.length, 1, 'no refresh while fresh');

  s.advance(3600_000 - 30_000);
  const second = await s.vault.accessToken();
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[1].get('grant_type'), 'refresh_token');
  assert.equal(s.calls[1].get('refresh_token'), 'refresh-1');
  assert.notEqual(second.access, first.access);
  s.advance(3600_000 - 30_000);
  await s.vault.accessToken();
  assert.equal(s.calls[2].get('refresh_token'), 'refresh-2', 'the rotated token is used next time');
});

test('many callers at once cause one refresh, and force refreshes even a fresh token', async () => {
  const s = setup(async (n) => (await new Promise((r) => setTimeout(r, 10)), ok(tokenBody(n))));
  await connect(s);
  s.advance(3600_000 - 10_000);
  const got = await Promise.all([1, 2, 3, 4, 5].map(() => s.vault.accessToken()));
  assert.equal(s.calls.length, 2, 'one exchange plus one refresh');
  assert.equal(new Set(got.map((g) => g.access)).size, 1);
  await s.vault.accessToken(true);
  assert.equal(s.calls.length, 3);
});

test('a dead refresh token disconnects and says to reconnect; a hiccup keeps the sign-in', async () => {
  const dead = setup((n) => (n === 1 ? ok(tokenBody(1)) : new Response('{"error":"invalid_grant"}', { status: 400 })));
  await connect(dead);
  dead.advance(3600_000);
  await assert.rejects(dead.vault.accessToken(), /expired.*connect/i);
  assert.deepEqual(await dead.vault.status(), { connected: false });
  assert.equal(dead.kv.data.size, 0);

  const blip = setup((n) => (n === 1 ? ok(tokenBody(1)) : n === 2 ? new Response('down', { status: 503 }) : ok(tokenBody(3))));
  await connect(blip);
  blip.advance(3600_000);
  await assert.rejects(blip.vault.accessToken(), /503/);
  assert.equal((await blip.vault.status()).connected, true);
  assert.ok((await blip.vault.accessToken()).access, 'the next try works');
});

test('not connected is an error that says how to connect', async () => {
  await assert.rejects(setup().vault.accessToken(), /isn't connected.*Admin/i);
});

test('disconnect wipes everything stored', async () => {
  const s = setup();
  await connect(s);
  await s.vault.start();
  await s.vault.disconnect();
  assert.equal(s.kv.data.size, 0);
  assert.deepEqual(await s.vault.status(), { connected: false });
  await assert.rejects(s.vault.accessToken(), /isn't connected/);
});
