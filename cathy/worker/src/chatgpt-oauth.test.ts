import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { jwt } from './test-fakes.ts';
import { accountFrom, exchangeCode, newLogin, parsePasted, refreshTokens, CLIENT_ID, TOKEN_URL, REDIRECT_URI } from './chatgpt-oauth.ts';

const AUTH = 'https://api.openai.com/auth';

test('a login has a PKCE challenge that matches its verifier, a state, and the Codex redirect', async () => {
  const a = await newLogin();
  const b = await newLogin();
  const u = new URL(a.url);
  assert.equal(u.origin + u.pathname, 'https://auth.openai.com/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(u.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('code_challenge'), createHash('sha256').update(a.verifier).digest('base64url'));
  assert.equal(u.searchParams.get('state'), a.state);
  assert.match(u.searchParams.get('scope')!, /offline_access/);
  assert.ok(a.verifier.length >= 43 && a.state.length >= 16);
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(a.state, b.state);
});

test('pasted sign-in results are understood in every shape', () => {
  assert.deepEqual(parsePasted('http://localhost:1455/auth/callback?code=abc&state=xyz'), { code: 'abc', state: 'xyz' });
  assert.deepEqual(parsePasted('  http://localhost:1455/auth/callback?code=abc&state=xyz\n'), { code: 'abc', state: 'xyz' });
  assert.deepEqual(parsePasted('abc#xyz'), { code: 'abc', state: 'xyz' });
  assert.deepEqual(parsePasted('code=abc&state=xyz'), { code: 'abc', state: 'xyz' });
  assert.deepEqual(parsePasted('abc'), { code: 'abc' });
  assert.deepEqual(parsePasted(''), {});
  assert.deepEqual(parsePasted('http://localhost:1455/auth/callback?error=access_denied&error_description=No'), { error: 'access_denied' });
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

test('the code is exchanged with the verifier, and the tokens come back with an expiry and the account', async () => {
  const seen: any[] = [];
  const fetch = async (url: any, init: any) => (seen.push({ url: String(url), body: new URLSearchParams(init.body), type: init.headers['content-type'] }), ok({ access_token: jwt({ [AUTH]: { chatgpt_account_id: 'acct_1' } }), refresh_token: 'r1', id_token: jwt({ email: 'c@example.com', [AUTH]: { chatgpt_plan_type: 'plus' } }), expires_in: 3600 }));
  const t = await exchangeCode('the-code', 'the-verifier', fetch as any, () => 1000);
  assert.equal(seen[0].url, TOKEN_URL);
  assert.equal(seen[0].type, 'application/x-www-form-urlencoded');
  assert.equal(seen[0].body.get('grant_type'), 'authorization_code');
  assert.equal(seen[0].body.get('code'), 'the-code');
  assert.equal(seen[0].body.get('code_verifier'), 'the-verifier');
  assert.equal(seen[0].body.get('client_id'), CLIENT_ID);
  assert.equal(seen[0].body.get('redirect_uri'), REDIRECT_URI);
  assert.equal(t.refresh, 'r1');
  assert.equal(t.expires, 1000 + 3600_000);
  assert.deepEqual(accountFrom(t), { accountId: 'acct_1', email: 'c@example.com', plan: 'plus' });
});

test('a failed exchange explains itself without echoing the code, verifier or response body', async () => {
  const fetch = async () => new Response('{"error":"invalid_grant","error_description":"secret-code-abc is bad"}', { status: 400 });
  await assert.rejects(exchangeCode('secret-code-abc', 'secret-verifier', fetch as any), (e: Error) => {
    assert.match(e.message, /sign-in failed \(400\)/i);
    assert.doesNotMatch(e.message, /secret-code-abc|secret-verifier/);
    return true;
  });
});

test('a response without the fields we need is refused', async () => {
  await assert.rejects(exchangeCode('c', 'v', (async () => ok({ access_token: 'x' })) as any), /incomplete/i);
  await assert.rejects(exchangeCode('c', 'v', (async () => ok({ access_token: jwt({}), refresh_token: 'r', expires_in: 1 })) as any), /account/i);
});

test('refresh keeps the old refresh token if none is sent, and flags a dead one as permanent', async () => {
  const access = jwt({ [AUTH]: { chatgpt_account_id: 'acct_1' } });
  const t = await refreshTokens('old', (async () => ok({ access_token: access, expires_in: 60 })) as any, () => 5);
  assert.equal(t.refresh, 'old');
  assert.equal(t.expires, 5 + 60_000);
  const rotated = await refreshTokens('old', (async () => ok({ access_token: access, refresh_token: 'new', expires_in: 60 })) as any);
  assert.equal(rotated.refresh, 'new');
  await assert.rejects(refreshTokens('old', (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as any), (e: any) => e.permanent === true);
  await assert.rejects(refreshTokens('old', (async () => new Response('oops', { status: 503 })) as any), (e: any) => e.permanent !== true && /503/.test(e.message));
});
