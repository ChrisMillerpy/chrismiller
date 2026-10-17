import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from './provider.ts';
import { createCathy } from '../../agent/cathy.ts';
import { turnSettings } from './models.ts';
import { Conversation, memoryStore } from './conversation.ts';
import type { Box } from '../../agent/box.ts';

test('GPT models need OPENAI_API_KEY, and the error says so', () => {
  assert.throws(() => buildModel({ ANTHROPIC_API_KEY: 'a' }, 'gpt-6-astra'), /OPENAI_API_KEY isn't set/);
});

test('Claude models still need ANTHROPIC_API_KEY, GPT ones do not', () => {
  assert.throws(() => buildModel({ OPENAI_API_KEY: 'o' }, 'claude-opus-5-5'), /ANTHROPIC_API_KEY isn't set/);
  assert.equal((buildModel({ OPENAI_API_KEY: 'o' }, 'gpt-6-astra') as any).provider.split('.')[0], 'openai');
  assert.equal((buildModel({ ANTHROPIC_API_KEY: 'a' }, 'claude-opus-5-5') as any).provider.split('.')[0], 'anthropic');
});

/** A fake OpenAI endpoint: records the request, answers with a short streamed reply. */
function fakeOpenAI(script: { call?: { name: string; args: unknown } } = {}) {
  const bodies: any[] = [];
  const urls: string[] = [];
  const fetch = async (url: any, init: any) => {
    urls.push(String(url));
    bodies.push(JSON.parse(init.body));
    const sawResult = JSON.stringify(JSON.parse(init.body).input).includes('function_call_output');
    const events = script.call && !sawResult ? callEvents(script.call) : [
      { type: 'response.created', response: { id: 'resp_1', created_at: 1, model: 'gpt-6-astra' } },
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1', role: 'assistant', content: [] } },
      { type: 'response.content_part.added', item_id: 'msg_1', output_index: 0, content_index: 0, part: { type: 'output_text', text: '' } },
      { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'Hello.' },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Hello.', annotations: [] }] } },
      { type: 'response.completed', response: { id: 'resp_1', created_at: 1, model: 'gpt-6-astra', output: [], usage: { input_tokens: 1, output_tokens: 1 } } },
    ];
    return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  return { fetch, bodies, urls };
}

const box: Box = {
  async run() {
    return { exitCode: 0, stdout: '', stderr: '' };
  },
  async readFile() {
    return '';
  },
  async writeFile() {},
};

test('a GPT turn goes to the Responses API with every tool, strict-compatible schemas, effort, summaries and store off', async () => {
  const api = fakeOpenAI();
  const model = buildModel({ OPENAI_API_KEY: 'o' }, 'gpt-6-astra', api.fetch as any);
  const agent = createCathy({ model, box, sessionId: 's', branch: 'cathy/s' });
  const settings = turnSettings('gpt-6-astra', 'max');
  const out = await agent.stream([{ role: 'user', content: 'hi' }], { ...settings.streamOptions });
  assert.equal((await out.text).trim(), 'Hello.');
  assert.match(api.urls[0], /\/responses$/);
  const body = api.bodies[0];
  assert.equal(body.model, 'gpt-6-astra');
  assert.equal(body.store, false);
  assert.equal(body.reasoning.effort, 'max');
  assert.equal(body.reasoning.summary, 'auto');
  assert.ok(body.tools.length >= 3, 'her tools are sent');
  for (const t of body.tools) {
    assert.equal(t.type, 'function');
    const props = Object.keys(t.parameters?.properties ?? {});
    if (t.strict) assert.deepEqual([...(t.parameters.required ?? [])].sort(), props.sort(), `${t.name}: strict mode needs every property required`);
    assert.equal(t.parameters?.type, 'object', t.name);
  }
});

test('every tool Cathy has in a real chat (box tools and chat tools) is sent to OpenAI with a valid schema', async () => {
  const api = fakeOpenAI();
  const model = buildModel({ OPENAI_API_KEY: 'o' }, 'gpt-6.1-sol', api.fetch as any);
  const store = memoryStore();
  const convo = new Conversation({
    store,
    broadcast: () => {},
    makeAgent: (tools, s) => createCathy({ model, box, sessionId: 's', branch: 'cathy/s', tools }),
    onActivity: async () => {},
    sendToCathy: async () => {},
    listCathys: async () => [],
    settings: async () => turnSettings('gpt-6.1-sol', 'medium'),
    setTitle: async () => true,
    publishArtifact: async () => ({}) as any,
    listArtifacts: async () => [],
  });
  await convo.fromChris('hello');
  assert.equal(store.messages().at(-1)!.content, 'Hello.');
  const tools = api.bodies[0].tools;
  const names = tools.map((t: any) => t.name).sort();
  for (const n of ['read_file', 'write_file', 'edit_file', 'list_files', 'grep', 'run_command', 'open_pr', 'set_title', 'publish_artifact', 'list_artifacts', 'tell_chris', 'list_cathys', 'message_cathy']) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
  for (const t of tools) {
    assert.equal(t.parameters?.type, 'object', t.name);
    // OpenAI strict mode: every property must be listed as required (optional ones become nullable).
    if (t.strict) assert.deepEqual([...(t.parameters.required ?? [])].sort(), Object.keys(t.parameters.properties ?? {}).sort(), `${t.name}: strict needs every property required`);
    assert.equal(t.parameters.additionalProperties, false, `${t.name}: needs additionalProperties: false`);
  }
});

function callEvents(call: { name: string; args: unknown }) {
  const item = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: call.name, arguments: JSON.stringify(call.args), status: 'completed' };
  return [
    { type: 'response.created', response: { id: 'resp_0', created_at: 1, model: 'gpt-6-astra' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } },
    { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: item.arguments },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'resp_0', created_at: 1, model: 'gpt-6-astra', output: [], usage: { input_tokens: 1, output_tokens: 1 } } },
  ];
}

test('GPT sends null for optional fields; the tools accept that and still run', async () => {
  const ran: string[] = [];
  const spyBox: Box = { ...box, async run(command) { ran.push(command); return { exitCode: 0, stdout: 'done', stderr: '' }; } };
  const api = fakeOpenAI({ call: { name: 'run_command', args: { command: 'echo hi', timeout_seconds: null } } });
  const model = buildModel({ OPENAI_API_KEY: 'o' }, 'gpt-6-astra', api.fetch as any);
  const agent = createCathy({ model, box: spyBox, sessionId: 's', branch: 'cathy/s' });
  const out = await agent.stream([{ role: 'user', content: 'run it' }], { maxSteps: 5, ...turnSettings('gpt-6-astra', 'low').streamOptions });
  assert.equal((await out.text).trim(), 'Hello.');
  assert.ok(ran.includes('echo hi'), 'the command ran despite timeout_seconds: null');
  assert.equal(api.bodies.length, 2, 'the result went back to the model');
});
