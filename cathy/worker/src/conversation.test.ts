import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation, MAX_HOPS, memoryStore, stoppedNote, tokens, type Event } from './conversation.ts';
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
  assert.ok(!store.messages().some((m) => m.role === 'tool'), 'the update is the step: no separate tool step');
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
  const guarded = store.messages().find((m) => m.step?.tool === 'message_cathy');
  assert.match(guarded?.step?.output ?? '', /loop guard/i, 'the refusal is shown on the step');
  assert.equal(guarded?.step?.failed, true);
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

test('thinking streams live and becomes a step in the timeline, but not in memory', async () => {
  const { convo, store, events, model } = withSettings([{ text: 'Answer.', thinking: 'Let me reason.' }, { text: 'ok' }]);
  await convo.fromChris('think');
  assert.ok(events.some((e) => e.type === 'thinking' && e.text === 'Let me reason.'));
  const think = store.messages().find((m) => m.step?.kind === 'think');
  assert.equal(think?.step?.text, 'Let me reason.');
  assert.equal(typeof think?.step?.ms, 'number');
  assert.equal(store.messages().at(-1)!.thinking, undefined, 'the reply no longer carries it');
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
  await waitFor(() => typeof release === 'function'); // the command is running in the box
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

// ── Steps: what Cathy did, described for Chris ──────────────────────────

function withBox(script: Step[], b: Box = box) {
  const model = fakeModel(script);
  const events: Event[] = [];
  const store = memoryStore();
  const convo = new Conversation({
    store,
    broadcast: (e) => events.push(e),
    makeAgent: (tools) => createCathy({ model: model as any, box: b, sessionId: 's', branch: 'cathy/s', tools }),
    onActivity: async () => {},
    sendToCathy: async () => {},
    listCathys: async () => [],
  });
  return { convo, events, store };
}

test('each tool call becomes a described step, then gains its output, timing and result', async () => {
  const { convo, store, events } = withBox([{ tool: 'run_command', input: { command: 'git status', description: 'Check the branch' } }, { text: 'Clean.' }]);
  await convo.fromChris('status?');
  const step = store.messages().find((m) => m.role === 'tool')!;
  assert.match(step.content, /run_command git status/, 'old-style content kept for older pages');
  assert.equal(step.step?.kind, 'tool');
  assert.equal(step.step?.tool, 'run_command');
  assert.equal(step.step?.desc, 'Check the branch');
  assert.equal(step.step?.input, 'git status');
  assert.match(step.step?.output ?? '', /On branch cathy\/s/);
  assert.equal(step.step?.failed, false);
  assert.equal(typeof step.step?.ms, 'number');
  const sent = events.find((e) => e.type === 'message' && e.message.seq === step.seq) as any;
  assert.equal(sent.message.step.output, undefined, 'shown at once, before it finishes');
  assert.ok(events.some((e) => e.type === 'changed' && e.message.seq === step.seq && e.message.step?.output), 'then updated with its result');
});

test('a failing command, and a tool that throws, are failed steps', async () => {
  const failing: Box = { ...box, run: async (cmd) => (/npm test/.test(cmd) ? { exitCode: 1, stdout: '1 failing', stderr: '' } : box.run(cmd)), readFile: async (p) => { if (p === 'nope.txt') throw new Error('ENOENT: nope.txt'); return box.readFile(p); } };
  const { convo, store } = withBox([{ tool: 'run_command', input: { command: 'npm test', description: 'Run the tests' } }, { tool: 'read_file', input: { path: 'nope.txt' } }, { text: 'Hmm.' }], failing);
  await convo.fromChris('test');
  const [run, read] = store.messages().filter((m) => m.role === 'tool');
  assert.equal(run.step?.failed, true);
  assert.match(run.step?.output ?? '', /\[exit 1\]/);
  assert.equal(read.step?.desc, 'Read nope.txt');
  assert.equal(read.step?.failed, true);
  assert.match(read.step?.output ?? '', /ENOENT: nope.txt/);
});

test('what Cathy says before a tool call is kept as a step, not thrown away', async () => {
  const { convo, store } = withBox([{ tool: 'run_command', input: { command: 'ls' }, say: 'Let me look around first.' }, { text: 'Done.' }]);
  await convo.fromChris('go');
  const roles = store.messages().map((m) => (m.step ? `step:${m.step.kind}` : m.role));
  assert.deepEqual(roles, ['user', 'step:text', 'step:tool', 'assistant']);
  assert.equal(store.messages()[1].step?.text, 'Let me look around first.');
  assert.equal(store.messages().at(-1)!.content, 'Done.');
});

test('a step still running when Chris stops is marked stopped', async () => {
  let release!: () => void;
  const slowBox: Box = { ...box, run: (cmd) => (/sleep/.test(cmd) ? new Promise((r) => (release = () => r({ exitCode: 0, stdout: 'done', stderr: '' }))) : box.run(cmd)) };
  const { convo, store } = withBox([{ tool: 'run_command', input: { command: 'sleep 100', description: 'Wait a long time' } }, { text: 'after' }], slowBox);
  const done = convo.fromChris('run it');
  await waitFor(() => store.messages().some((m) => m.role === 'tool'));
  await waitFor(() => typeof release === 'function'); // the command is running in the box
  convo.stop();
  // Stop frees Cathy at once: the box command finishes on its own, but the turn doesn't wait for it.
  const freed = await Promise.race([done.then(() => true), new Promise((r) => setTimeout(() => r(false), 1000))]);
  release();
  await done;
  assert.equal(freed, true, 'the turn ended without waiting for the box command');
  assert.equal(convo.status, 'idle');
  const step = store.messages().find((m) => m.role === 'tool')!;
  assert.equal(step.step?.stopped, true, JSON.stringify(step.step));
  assert.equal(typeof step.step?.ms, 'number');
});

test("after a stop, Cathy's memory notes what she'd said and finished", () => {
  assert.equal(stoppedNote('Looking now. ', ['Check the branch', 'Run the tests (failed)']), "Looking now.\n\nSteps I'd finished: Check the branch; Run the tests (failed).\n\n(Chris stopped me here.)");
  assert.equal(stoppedNote('', []), '(Chris stopped me here.)');
});
