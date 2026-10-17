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

test('attachments: images are shown to Cathy, every file is put in her box, and memory keeps only the paths', async () => {
  const model = fakeModel([{ text: 'Nice graph.' }, { text: 'Still remember.' }]);
  const store = memoryStore();
  const attached: string[] = [];
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const convo = new Conversation({
    store,
    broadcast: () => {},
    makeAgent: (tools) => createCathy({ model: model as any, box, sessionId: 's', branch: 'cathy/s', tools }),
    onActivity: async () => {},
    sendToCathy: async () => {},
    listCathys: async () => [],
    attach: async (files) => {
      attached.push(...files.map((f) => f.id));
      return files.map((f) => ({ ...f, path: `/uploads/${f.name}`, bytes: f.mime === 'image/png' ? png : new Uint8Array([1]) }));
    },
  });
  const files = [
    { id: 'u1', name: 'graph.png', mime: 'image/png', size: 7 },
    { id: 'u2', name: 'data.csv', mime: 'text/csv', size: 1 },
  ];
  await convo.fromChris('What do you see?', files);
  assert.deepEqual(attached, ['u1', 'u2']);
  assert.deepEqual(store.messages()[0].files, files);

  const prompt = JSON.stringify((model.calls[0] as any).prompt.at(-1));
  assert.match(prompt, /\/uploads\/graph\.png/);
  assert.match(prompt, /\/uploads\/data\.csv/);
  assert.match(prompt, /image\/png/, 'the image goes to the model');
  assert.doesNotMatch(prompt, /"mediaType":"text\/csv"/, 'a CSV is only in the box, not sent inline');

  await convo.fromChris('and now?');
  const remembered = JSON.stringify((model.calls[1] as any).prompt);
  assert.match(remembered, /\/uploads\/graph\.png/, 'she remembers where the file is');
  assert.equal((model.calls[1] as any).prompt.filter((m: any) => m.role === 'user' && Array.isArray(m.content) && m.content.some((p: any) => p.type === 'file')).length, 0, 'old images are not resent');
});

test('a message with only files still counts as activity', async () => {
  const { convo, activity } = setup([{ text: 'Got it.' }]);
  await convo.fromChris('', [{ id: 'u', name: 'a.pdf', mime: 'application/pdf', size: 3 }]);
  assert.equal(activity[0], '📎 a.pdf');
});

test('set_title names the chat and tells open pages; Chris\'s name is kept', async () => {
  const events: Event[] = [];
  let named = '';
  let chrisNamed = false;
  const model = fakeModel([{ tool: 'set_title', input: { title: 'Blog header fix' } }, { text: 'ok' }, { tool: 'set_title', input: { title: 'Other' } }, { text: 'ok' }]);
  const convo = new Conversation({
    store: memoryStore(),
    broadcast: (e) => events.push(e),
    makeAgent: (tools) => createCathy({ model: model as any, box, sessionId: 's', branch: 'cathy/s', tools }),
    onActivity: async () => {},
    sendToCathy: async () => {},
    listCathys: async () => [],
    setTitle: async (t) => {
      if (chrisNamed) return false;
      named = t;
      return true;
    },
  });
  await convo.fromChris('fix the blog header');
  assert.equal(named, 'Blog header fix');
  assert.ok(events.some((e) => e.type === 'title' && e.title === 'Blog header fix'));
  chrisNamed = true;
  await convo.fromChris('something else');
  assert.equal(named, 'Blog header fix');
  assert.equal(events.filter((e) => e.type === 'title').length, 1);
});

test('publish_artifact posts an artifact card and returns the links', async () => {
  const published: any[] = [];
  const model = fakeModel([{ tool: 'publish_artifact', input: { path: 'out/ws.html', title: 'Fractions worksheet', visibility: 'link' } }, { text: 'Done.' }]);
  const store = memoryStore();
  const convo = new Conversation({
    store,
    broadcast: () => {},
    makeAgent: (tools) => createCathy({ model: model as any, box, sessionId: 's', branch: 'cathy/s', tools }),
    onActivity: async () => {},
    sendToCathy: async () => {},
    listCathys: async () => [],
    publishArtifact: async (a) => {
      published.push(a);
      return { id: 'a1', title: a.title, filename: 'ws.html', mime: 'text/html', size: 10, visibility: a.visibility ?? 'private', admin_url: '/artifacts/a1', share_url: 'https://share/a/tok' };
    },
  });
  await convo.fromChris('make a worksheet and give me a link');
  assert.deepEqual(published, [{ path: 'out/ws.html', title: 'Fractions worksheet', visibility: 'link' }]);
  const card = store.messages().find((m) => m.role === 'artifact');
  assert.ok(card);
  assert.equal(JSON.parse(card!.content).share_url, 'https://share/a/tok');
  assert.match(JSON.stringify((model.calls[1] as any).prompt), /Share link: https:\/\/share\/a\/tok/);
});
