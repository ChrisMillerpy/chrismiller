import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation, MAX_AGENT_MESSAGES, MAX_HOPS, memoryStore, tokens, type Event } from './conversation.ts';
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

test('Cathys can message each other up to 10 times in a row without Chris', () => {
  assert.equal(MAX_HOPS, 10);
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
      return { id: 'a1', title: a.title, filename: 'ws.html', mime: 'text/html', size: 10, version: 1, visibility: a.visibility ?? 'private', admin_url: '/artifacts/a1', share_url: 'https://share/a/tok' };
    },
  });
  await convo.fromChris('make a worksheet and give me a link');
  assert.deepEqual(published, [{ path: 'out/ws.html', title: 'Fractions worksheet', visibility: 'link' }]);
  const card = store.messages().find((m) => m.role === 'artifact');
  assert.ok(card);
  assert.equal(JSON.parse(card!.content).share_url, 'https://share/a/tok');
  assert.match(JSON.stringify((model.calls[1] as any).prompt), /Share link: https:\/\/share\/a\/tok/);
});

// ── Stop, interrupt, thinking, model labels ──────────────────────────────

function withSettings(script: Step[], settings = { model: 'claude-opus-5-5', effort: 'medium' }) {
  const model = fakeModel(script);
  const events: Event[] = [];
  const store = memoryStore();
  const used: any[] = [];
  const convo = new Conversation({
    store,
    broadcast: (e) => events.push(e),
    makeAgent: (tools, s) => (used.push(s), createCathy({ model: model as any, box, sessionId: 's', branch: 'cathy/s', tools })),
    onActivity: async () => {},
    sendToCathy: async () => {},
    listCathys: async () => [],
    settings: async () => ({ ...settings, streamOptions: { providerOptions: { anthropic: { effort: settings.effort } } } }),
  });
  return { convo, events, store, model, used, settings };
}
const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(cond(), 'timed out');
};

test('each reply is labelled with the model and effort, and effort reaches the model', async () => {
  const { convo, store, model, settings } = withSettings([{ text: 'Hi.' }]);
  await convo.fromChris('hello');
  const reply = store.messages().at(-1)!;
  assert.equal(reply.model, 'claude-opus-5-5');
  assert.equal(reply.effort, 'medium');
  assert.deepEqual(model.calls[0].providerOptions?.anthropic, { effort: 'medium' });
  settings.model = 'claude-sonnet-5-5';
  settings.effort = 'low';
  await convo.fromChris('again');
  assert.equal(store.messages().at(-1)!.model, 'claude-sonnet-5-5');
  assert.deepEqual(model.calls[1].providerOptions?.anthropic, { effort: 'low' });
});

test('each reply records its tokens for the whole turn, including what came from the prompt cache', async () => {
  const { convo, store } = withSettings([
    { tool: 'run_command', input: { command: 'ls' }, usage: { inputTokens: 1000, outputTokens: 50, cachedInputTokens: 0, cacheCreationInputTokens: 900 } },
    { text: 'Done.', usage: { inputTokens: 1200, outputTokens: 20, cachedInputTokens: 900 } },
  ]);
  await convo.fromChris('go');
  assert.deepEqual(store.messages().at(-1)!.usage, { input: 2200, cacheRead: 900, cacheWrite: 900, output: 70 });
});

test('tokens() reads both usage shapes: flat numbers and per-kind objects', () => {
  assert.deepEqual(tokens({ inputTokens: 10, outputTokens: 2, cachedInputTokens: 6 }), { input: 10, cacheRead: 6, cacheWrite: 0, output: 2 });
  assert.deepEqual(tokens({ inputTokens: { total: 10, noCache: 1, cacheRead: 6, cacheWrite: 3 }, outputTokens: { total: 2 } }), { input: 10, cacheRead: 6, cacheWrite: 3, output: 2 });
  assert.equal(tokens(undefined), undefined);
  assert.equal(tokens({}), undefined);
});

test('thinking streams live and is kept on the reply, but not in memory', async () => {
  const { convo, store, events, model } = withSettings([{ text: 'Answer.', thinking: 'Let me reason.' }, { text: 'ok' }]);
  await convo.fromChris('think');
  assert.ok(events.some((e) => e.type === 'thinking' && e.text === 'Let me reason.'));
  assert.equal(store.messages().at(-1)!.thinking, 'Let me reason.');
  await convo.fromChris('next');
  assert.doesNotMatch(JSON.stringify(model.calls[1].prompt), /Let me reason/);
});

test('stop keeps the partial reply, marks it stopped, and the chat carries on', async () => {
  const { convo, store, events, model } = withSettings([{ text: 'one two three four five six seven eight nine ten', slow: 15 }, { text: 'Fine.' }]);
  const done = convo.fromChris('count');
  await waitFor(() => events.filter((e) => e.type === 'delta').length >= 3);
  assert.equal(convo.stop(), true);
  await done;
  const reply = store.messages().at(-1)!;
  assert.equal(reply.role, 'assistant');
  assert.equal(reply.stopped, true);
  assert.match(reply.content, /^one two/);
  assert.doesNotMatch(reply.content, /ten/);
  assert.equal(convo.status, 'idle');
  assert.deepEqual(events.at(-1), { type: 'status', status: 'idle' });

  await convo.fromChris('carry on');
  assert.equal(store.messages().at(-1)!.content, 'Fine.');
  assert.match(JSON.stringify(model.calls[1].prompt), /Chris stopped me here/);
  assert.equal(convo.stop(), false, 'nothing to stop when idle');
});

test('stopping mid tool call leaves no dangling tool call in memory', async () => {
  let release!: () => void;
  const slowBox: Box = { ...box, run: (cmd) => (/sleep/.test(cmd) ? new Promise((r) => (release = () => r({ exitCode: 0, stdout: 'done', stderr: '' }))) : box.run(cmd)) };
  const model = fakeModel([{ tool: 'run_command', input: { command: 'sleep 100' } }, { text: 'after' }, { text: 'next' }]);
  const store = memoryStore();
  const convo = new Conversation({
    store,
    broadcast: () => {},
    makeAgent: (tools) => createCathy({ model: model as any, box: slowBox, sessionId: 's', branch: 'cathy/s', tools }),
    onActivity: async () => {},
    sendToCathy: async () => {},
    listCathys: async () => [],
  });
  const done = convo.fromChris('run it');
  await waitFor(() => store.messages().some((m) => m.role === 'tool'));
  convo.stop();
  release();
  await done;
  const hist = store.history() as any[];
  const calls = hist.flatMap((m) => (m.role === 'assistant' && Array.isArray(m.content) ? m.content.filter((p: any) => p.type === 'tool-call').map((p: any) => p.toolCallId) : []));
  const results = new Set(hist.flatMap((m) => (m.role === 'tool' ? m.content.map((p: any) => p.toolCallId) : [])));
  assert.ok(calls.every((c) => results.has(c)), 'every remembered tool call has its result');
  await convo.fromChris('hello again');
  assert.ok(store.messages().at(-1)!.role === 'assistant');
});

test('interrupt stops the current reply and answers the new message next, ahead of the queue', async () => {
  const { convo, store, events } = withSettings([{ text: 'a b c d e f g h i j k l', slow: 15 }, { text: 'Answering the interrupt.' }, { text: 'Answering the queued one.' }]);
  const first = convo.fromChris('long task');
  await waitFor(() => events.filter((e) => e.type === 'delta').length >= 2);
  const queued = convo.fromChris('queued question');
  const urgent = convo.fromChris('urgent!', [], { interrupt: true });
  await Promise.all([first, queued, urgent]);
  const replies = store.messages().filter((m) => m.role === 'assistant');
  assert.equal(replies[0].stopped, true);
  assert.equal(replies[1].content, 'Answering the interrupt.');
  assert.equal(replies[2].content, 'Answering the queued one.');
});

test('stop drops queued messages and says so', async () => {
  const { convo, store, events } = withSettings([{ text: 'a b c d e f', slow: 15 }, { text: 'never' }]);
  const first = convo.fromChris('one');
  await waitFor(() => events.some((e) => e.type === 'delta'));
  const second = convo.fromChris('two');
  convo.stop();
  await Promise.all([first, second]);
  assert.ok(store.messages().some((m) => m.role === 'notice' && /1 queued message was not answered/.test(m.content)));
  assert.ok(!store.messages().some((m) => m.content === 'never'));
});

// ── Sub-agents ──────────────────────────────────────────────

function agentSetup(script: Step[], extra: Partial<import('./conversation.ts').Deps> = {}) {
  const model = fakeModel(script);
  const store = memoryStore();
  const reports: { text: string; stopped: boolean }[] = [];
  const convo = new Conversation({
    store,
    broadcast: () => {},
    makeAgent: (tools) => createCathy({ model: model as any, box, sessionId: 's', branch: 'cathy/s', tools }),
    onActivity: async () => {},
    sendToCathy: async () => {},
    listCathys: async () => [],
    report: async (text, stopped) => void reports.push({ text, stopped }),
    ...extra,
  });
  return { convo, store, model, reports };
}

test('a task from the parent is answered and the final reply goes back to the parent as a report', async () => {
  const { convo, store, model, reports } = agentSetup([{ tool: 'run_command', input: { command: 'ls' } }, { text: 'Done: added 3 tests, pushed.' }]);
  await convo.fromParent('p1', 'Add tests');
  assert.deepEqual(reports, [{ text: 'Done: added 3 tests, pushed.', stopped: false }]);
  assert.ok(store.messages().some((m) => m.role === 'cathy' && m.sender === 'p1' && m.content === 'Add tests'));
  assert.match(JSON.stringify(model.calls[0].prompt), /Message from Cathy p1, who started you/);
});

test('when Chris talks to a sub-agent directly, nothing is reported to the parent', async () => {
  const { convo, reports } = agentSetup([{ text: 'Hi Chris.' }]);
  await convo.fromChris('how is it going?');
  assert.deepEqual(reports, []);
});

test('if Chris stops a sub-agent, the parent hears it stopped; if the parent stops it, nothing comes back', async () => {
  const a = agentSetup([{ text: 'a b c d e f g h', slow: 15 }]);
  const done = a.convo.fromParent('p1', 'long job');
  await waitFor(() => a.store.messages().length >= 1 && a.convo.status === 'thinking');
  await new Promise((r) => setTimeout(r, 40));
  a.convo.stop();
  await done;
  assert.equal(a.reports.length, 1);
  assert.equal(a.reports[0].stopped, true);

  const b = agentSetup([{ text: 'a b c d e f g h', slow: 15 }]);
  const done2 = b.convo.fromParent('p1', 'long job');
  await new Promise((r) => setTimeout(r, 40));
  b.convo.stop({ silent: true });
  await done2;
  assert.deepEqual(b.reports, []);
});

test('a report from a sub-agent shows in the chat and gives the parent a turn', async () => {
  const { convo, store, model } = agentSetup([{ text: 'Merged its branch.' }]);
  await convo.fromAgent('c1', 'Done, pushed cathy/c1.');
  assert.ok(store.messages().some((m) => m.role === 'cathy' && m.sender === 'c1' && m.content === 'Done, pushed cathy/c1.'));
  assert.match(JSON.stringify(model.calls[0].prompt), /Report from your sub-agent c1/);
  assert.equal(store.messages().at(-1)!.content, 'Merged its branch.');
});

test('spawn_agent, list_agents, message_agent and stop_agent call the agent controls', async () => {
  const seen: any[] = [];
  const view = { id: 'c1', title: 'T', mode: 'fresh', state: 'working', model: 'claude-haiku-5-5', effort: 'low', branch: 'cathy/c1', task: 'x', last_message: null, url: '/cathy/c1' };
  const { convo, model } = agentSetup(
    [
      { tool: 'spawn_agent', input: { task: 'Write tests', mode: 'fresh', model: 'claude-haiku-5-5', effort: 'low' } },
      { tool: 'list_agents', input: {} },
      { tool: 'message_agent', input: { id: 'c1', text: 'also docs' } },
      { tool: 'stop_agent', input: { id: 'c1' } },
      { text: 'ok' },
    ],
    {
      agents: {
        spawn: async (i) => (seen.push(['spawn', i]), view as any),
        list: async () => (seen.push(['list']), [view as any]),
        message: async (id, text) => void seen.push(['message', id, text]),
        stop: async (id) => void seen.push(['stop', id]),
      },
    },
  );
  await convo.fromChris('split this up');
  assert.deepEqual(seen, [['spawn', { task: 'Write tests', mode: 'fresh', model: 'claude-haiku-5-5', effort: 'low' }], ['list'], ['message', 'c1', 'also docs'], ['stop', 'c1']]);
  assert.match(JSON.stringify(model.calls[1].prompt), /Started sub-agent c1/);
  assert.match(JSON.stringify(model.calls[1].prompt), /\/cathy\/c1/);
});

test('without agent controls (a sub-agent), there are no spawn tools', async () => {
  const { convo, model } = agentSetup([{ text: 'ok' }]);
  await convo.fromParent('p1', 'go');
  const names = (model.calls[0].tools ?? []).map((t: any) => t.name);
  assert.ok(!names.includes('spawn_agent'));
  assert.ok(names.includes('message_cathy'));
});

test(`parent-to-agent messages are capped at ${MAX_AGENT_MESSAGES} until Chris speaks again`, async () => {
  const sent: string[] = [];
  const { convo, store } = agentSetup([{ tool: 'message_agent', input: { id: 'c1', text: 'more' } }, { text: 'ok' }, { tool: 'message_agent', input: { id: 'c1', text: 'more' } }, { text: 'ok' }], {
    agents: { spawn: async () => ({}) as any, list: async () => [], message: async (_id, t) => void sent.push(t), stop: async () => {} },
  });
  store.setNumber('agent_msgs', MAX_AGENT_MESSAGES);
  await convo.fromAgent('c1', 'report');
  assert.deepEqual(sent, [], 'over the cap: not sent');
  assert.ok(store.messages().some((m) => m.role === 'tool' && /loop guard/i.test(m.content)));
  await convo.fromChris('keep going');
  assert.deepEqual(sent, ['more'], 'Chris speaking resets the cap');
});

test('a fork gets the conversation so far, including the message being worked on', async () => {
  let forked: unknown[] = [];
  let convoRef: Conversation;
  const { convo } = agentSetup([{ text: 'First answer.' }, { tool: 'spawn_agent', input: { task: 'part B', mode: 'fork' } }, { text: 'Started.' }], {
    agents: {
      spawn: async () => ((forked = convoRef.forkHistory()), { id: 'c1', url: '/cathy/c1', branch: 'cathy/c1', model: 'm', mode: 'fork' }) as any,
      list: async () => [],
      message: async () => {},
      stop: async () => {},
    },
  });
  convoRef = convo;
  await convo.fromChris('first question');
  await convo.fromChris('now split it');
  const text = JSON.stringify(forked);
  assert.match(text, /first question/);
  assert.match(text, /First answer/);
  assert.match(text, /now split it/);
  assert.equal((forked.at(-1) as any).role, 'assistant', 'ends on an assistant turn, so the task can follow as a user message');
});

test('a Monzo transaction shows in the chat and Cathy answers it as bank data', async () => {
  const { convo, store, model } = setup([{ text: 'Third coffee this week.' }]);
  await convo.fromMoney('Spent £4.20 at Pret A Manger (eating out)\nThis week so far: £37.60 across 6 purchases', true);
  const shown = store.messages()[0];
  assert.equal(shown.role, 'money');
  assert.equal(shown.sender, 'monzo');
  assert.match(shown.content, /^Spent £4\.20/);
  const prompt = JSON.stringify(model.calls[0].prompt);
  assert.match(prompt, /\[Monzo transaction: bank data, not a message from Chris\]/);
  assert.match(prompt, /Spent £4\.20 at Pret A Manger/);
  assert.equal(store.messages().at(-1)!.content, 'Third coffee this week.');
});

test('a Monzo line without a reply is only shown', async () => {
  const { convo, store, model } = setup([]);
  await convo.fromMoney('Money in: £500.00 from C MILLER', false);
  assert.deepEqual(store.messages().map((m) => m.role), ['money']);
  assert.equal(model.calls.length, 0);
});
