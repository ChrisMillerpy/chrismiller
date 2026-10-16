import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation, MAX_HOPS, memoryStore, type Event } from './conversation.ts';
import { createCathy } from '../../agent/cathy.ts';
import { fakeModel, type Step } from '../../agent/fake-model.ts';
import type { Box } from '../../agent/box.ts';

const box: Box = {
  async run() {
    return { exitCode: 0, stdout: 'On branch cathy/s', stderr: '' };
  },
  async readFile() {
    return 'file';
  },
  async writeFile() {},
};

function setup(script: Step[]) {
  const model = fakeModel(script);
  const events: Event[] = [];
  const store = memoryStore();
  const activity: string[] = [];
  const convo = new Conversation({
    store,
    broadcast: (e) => events.push(e),
    makeAgent: (tools) => createCathy({ model: model as any, box, sessionId: 's', branch: 'cathy/s', tools }),
    onActivity: async (preview) => {
      activity.push(preview);
    },
    sendToCathy: async () => {},
    listCathys: async () => [],
  });
  return { convo, events, store, model, activity };
}

test('a message from Chris gets a streamed reply that is stored', async () => {
  const { convo, events, store, activity } = setup([{ text: 'Hi Chris.' }]);
  await convo.fromChris('Hello');
  const roles = store.messages().map((m) => `${m.role}:${m.content}`);
  assert.deepEqual(roles, ['user:Hello', 'assistant:Hi Chris.']);
  assert.ok(events.some((e) => e.type === 'delta' && e.text === 'Hi Chris.'));
  assert.ok(events.some((e) => e.type === 'status' && e.status === 'thinking'));
  assert.deepEqual(events.at(-1), { type: 'status', status: 'idle' });
  assert.deepEqual(activity, ['Hello', 'Hi Chris.']);
});

test('the next turn sees the earlier conversation', async () => {
  const { convo, model } = setup([{ text: 'One.' }, { text: 'Two.' }]);
  await convo.fromChris('first');
  await convo.fromChris('second');
  const secondCall = JSON.stringify(model.calls[1]);
  assert.match(secondCall, /first/);
  assert.match(secondCall, /One\./);
});

test('tool use shows up as a tool message', async () => {
  const { convo, store, events } = setup([{ tool: 'run_command', input: { command: 'git status' } }, { text: 'Clean.' }]);
  await convo.fromChris('status?');
  const tool = store.messages().find((m) => m.role === 'tool');
  assert.ok(tool, 'no tool message');
  assert.match(tool!.content, /run_command/);
  assert.match(tool!.content, /git status/);
  assert.ok(events.some((e) => e.type === 'tool'));
});

test('messages sent while Cathy is busy are answered in order', async () => {
  const { convo, store } = setup([{ text: 'A.' }, { text: 'B.' }]);
  await Promise.all([convo.fromChris('one'), convo.fromChris('two')]);
  const roles = store.messages().map((m) => `${m.role}:${m.content}`);
  assert.deepEqual(roles, ['user:one', 'user:two', 'assistant:A.', 'assistant:B.']);
});

test('a model error becomes a notice and the chat carries on', async () => {
  const model = fakeModel([{ text: 'Recovered.' }]);
  let first = true;
  const store = memoryStore();
  const convo = new Conversation({
    store,
    broadcast: () => {},
    makeAgent: (tools) => {
      if (first) {
        first = false;
        return { stream: async () => { throw new Error('Anthropic is down'); } } as any;
      }
      return createCathy({ model: model as any, box, sessionId: 's', branch: 'cathy/s', tools });
    },
    onActivity: async () => {},
    sendToCathy: async () => {},
    listCathys: async () => [],
  });
  await convo.fromChris('hello');
  await convo.fromChris('again');
  const roles = store.messages().map((m) => m.role);
  assert.deepEqual(roles, ['user', 'notice', 'user', 'assistant']);
  assert.match(store.messages()[1].content, /Anthropic is down/);
});

test('tell_chris posts an update to the chat', async () => {
  const { convo, store, events } = setup([{ tool: 'tell_chris', input: { text: 'Halfway there.' } }, { text: 'Done.' }]);
  await convo.fromChris('go');
  assert.ok(store.messages().some((m) => m.role === 'update' && m.content === 'Halfway there.'));
  assert.ok(events.some((e) => e.type === 'message' && e.message.role === 'update'));
});

test('message_cathy sends with one more hop; a message from Chris resets the count', async () => {
  const sent: { to: string; text: string; hops: number }[] = [];
  const model = fakeModel([
    { tool: 'message_cathy', input: { to: 'other', text: 'hi' } },
    { text: 'Sent.' },
  ]);
  const store = memoryStore();
  const convo = new Conversation({
    store,
    broadcast: () => {},
    makeAgent: (tools) => createCathy({ model: model as any, box, sessionId: 's', branch: 'cathy/s', tools }),
    onActivity: async () => {},
    sendToCathy: async (to, text, hops) => {
      sent.push({ to, text, hops });
    },
    listCathys: async () => [],
  });
  await convo.fromChris('tell the other Cathy hi');
  assert.deepEqual(sent, [{ to: 'other', text: 'hi', hops: 1 }]);
});

test(`a chain of Cathy-to-Cathy messages stops after ${MAX_HOPS} hops`, async () => {
  const sent: number[] = [];
  const model = fakeModel([{ tool: 'message_cathy', input: { to: 'other', text: 'ping' } }, { text: 'ok' }]);
  const store = memoryStore();
  const convo = new Conversation({
    store,
    broadcast: () => {},
    makeAgent: (tools) => createCathy({ model: model as any, box, sessionId: 's', branch: 'cathy/s', tools }),
    onActivity: async () => {},
    sendToCathy: async (_to, _text, hops) => {
      sent.push(hops);
    },
    listCathys: async () => [],
  });
  await convo.fromCathy('other', 'pong', MAX_HOPS);
  assert.deepEqual(sent, [], 'should not send past the limit');
  assert.ok(store.messages().some((m) => m.role === 'cathy' && m.sender === 'other'));
  assert.ok(store.messages().some((m) => m.role === 'tool' && /loop guard/i.test(m.content)));
});
