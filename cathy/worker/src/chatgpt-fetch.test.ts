import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatgptFetch, toCodexBody, BASE_URL } from './chatgpt-fetch.ts';

const ACCESS = 'access-token-SECRET';
const source = (calls: boolean[] = []) => async (force?: boolean) => (calls.push(!!force), { access: force ? 'refreshed-SECRET' : ACCESS, accountId: 'acct_1' });

function backend(replies: Response[] = []) {
  const seen: { url: string; headers: Headers; body: any; redirect?: string }[] = [];
  const fetch = async (url: any, init: any) => {
    seen.push({ url: String(url), headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : undefined, redirect: init.redirect });
    return replies.shift() ?? new Response('data: {"type":"response.completed"}\n\n', { status: 200 });
  };
  return { fetch, seen };
}
const post = (f: typeof fetch, body: unknown, headers: Record<string, string> = {}) => f(`${BASE_URL}/responses`, { method: 'POST', headers: { authorization: 'Bearer dummy-from-sdk', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('the body is made stateless and Codex-shaped: no ids, no references, stored nowhere, streamed', () => {
  const out = toCodexBody(
    {
      model: 'gpt-6-astra',
      store: true,
      stream: false,
      max_output_tokens: 100,
      previous_response_id: 'resp_1',
      input: [
        { role: 'system', content: 'You are Cathy.' },
        { type: 'item_reference', id: 'rs_1' },
        { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
        { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'run_command', arguments: '{}' },
        { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
        { type: 'reasoning', id: 'rs_2', summary: [], encrypted_content: 'enc' },
      ],
    },
    { instructions: 'Be exact.', cacheKey: 'chat-1' },
  );
  assert.equal(out.store, false);
  assert.equal(out.stream, true);
  assert.equal(out.instructions, 'Be exact.');
  assert.equal(out.max_output_tokens, undefined);
  assert.equal(out.previous_response_id, undefined);
  assert.equal(out.prompt_cache_key, 'chat-1');
  assert.deepEqual(out.include, ['reasoning.encrypted_content']);
  assert.equal(out.input.length, 5, 'the item_reference is dropped');
  assert.ok(out.input.every((i: any) => i.id === undefined), 'no ids');
  assert.equal(out.input[0].role, 'developer', 'system becomes developer');
  assert.deepEqual(out.input.map((i: any) => i.call_id).filter(Boolean), ['call_1', 'call_1'], 'tool calls still pair up');
  assert.equal(out.input.at(-1).encrypted_content, 'enc');
});

test('a request carries the ChatGPT token, account and Codex headers, replaces the SDK key, and never follows redirects', async () => {
  const b = backend();
  const f = chatgptFetch({ token: source(), fetch: b.fetch as any, cacheKey: 'chat-1' });
  await post(f, { model: 'gpt-6-astra', input: [] }, { 'x-api-key': 'sk-should-go' });
  const r = b.seen[0];
  assert.equal(r.url, 'https://chatgpt.com/backend-api/codex/responses');
  assert.equal(r.headers.get('authorization'), `Bearer ${ACCESS}`);
  assert.equal(r.headers.get('chatgpt-account-id'), 'acct_1');
  assert.equal(r.headers.get('openai-beta'), 'responses=experimental');
  assert.equal(r.headers.get('originator'), 'codex_cli_rs');
  assert.equal(r.headers.get('accept'), 'text/event-stream');
  assert.equal(r.headers.get('session_id'), 'chat-1');
  assert.equal(r.headers.get('x-api-key'), null);
  assert.equal(r.redirect, 'manual');
  assert.equal(r.body.store, false);
  assert.equal(r.body.stream, true);
  assert.ok(r.body.instructions.length > 20, 'there are always instructions');
});

test('the token is only ever sent to chatgpt.com, and never requested for anywhere else', async () => {
  const calls: boolean[] = [];
  const b = backend();
  const f = chatgptFetch({ token: source(calls), fetch: b.fetch as any });
  for (const url of ['https://api.openai.com/v1/responses', 'https://chatgpt.com.evil.example/backend-api/codex/responses', 'http://chatgpt.com/backend-api/codex/responses', 'https://evil.example/?https://chatgpt.com/', 'https://user@chatgpt.com/backend-api/x', 'https://chatgpt.com:8443/backend-api/x']) {
    await assert.rejects(f(url, { method: 'POST', body: '{}' }), /only talks to chatgpt\.com/i, url);
  }
  assert.equal(b.seen.length, 0, 'nothing was sent');
  assert.equal(calls.length, 0, 'the token was never even fetched');
});

test('an expired token is refreshed once and the request retried; a second 401 is passed on', async () => {
  const calls: boolean[] = [];
  const b = backend([new Response('{"error":"expired"}', { status: 401 })]);
  const f = chatgptFetch({ token: source(calls), fetch: b.fetch as any });
  const res = await post(f, { model: 'm', input: [] });
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [false, true], 'second fetch of the token was forced');
  assert.equal(b.seen[1].headers.get('authorization'), 'Bearer refreshed-SECRET');

  const b2 = backend([new Response('no', { status: 401 }), new Response('still no', { status: 401 })]);
  const res2 = await post(chatgptFetch({ token: source(), fetch: b2.fetch as any }), { model: 'm', input: [] });
  assert.equal(res2.status, 401);
  assert.equal(b2.seen.length, 2, 'only one retry');
});

test('hitting the plan limit gives a plain message, not raw JSON', async () => {
  for (const status of [404, 429]) {
    const b = backend([new Response(JSON.stringify({ error: { type: 'usage_limit_reached', resets_in_seconds: 5400, message: 'x' } }), { status })]);
    const res = await post(chatgptFetch({ token: source(), fetch: b.fetch as any }), { model: 'm', input: [] });
    assert.equal(res.status, 429);
    const msg = (await res.json()).error.message;
    assert.match(msg, /ChatGPT plan.*limit/i);
    assert.match(msg, /about 1 hour 30 minutes/);
  }
  const other = backend([new Response('{"error":{"message":"Model not found"}}', { status: 404 })]);
  const res = await post(chatgptFetch({ token: source(), fetch: other.fetch as any }), { model: 'm', input: [] });
  assert.equal(res.status, 404, 'other 404s are left alone');
});

test('no token, account id or request body is ever written to the console', async () => {
  const logged: string[] = [];
  const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(saved)) (console as any)[k] = (...a: unknown[]) => logged.push(a.map(String).join(' '));
  try {
    const b = backend([new Response('no', { status: 401 }), new Response('bad', { status: 500 })]);
    await post(chatgptFetch({ token: source(), fetch: b.fetch as any }), { model: 'm', input: [{ role: 'user', content: 'private words' }] });
  } finally {
    Object.assign(console, saved);
  }
  assert.doesNotMatch(logged.join('\n'), /SECRET|acct_1|private words/);
});
