import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation, memoryStore } from './conversation.ts';
import { createCathy } from '../../agent/cathy.ts';
import { demoBox, demoModel } from './demo.ts';

test('demo Cathy checks her box, then answers quoting what Chris said', async () => {
  const store = memoryStore();
  const convo = new Conversation({
    store,
    broadcast: () => {},
    makeAgent: (tools) => createCathy({ model: demoModel() as any, box: demoBox('cathy/abc'), sessionId: 'abc', branch: 'cathy/abc', tools }),
    onActivity: async () => {},
    sendToCathy: async () => {},
    listCathys: async () => [],
  });
  await convo.fromChris('hello there');
  const [user, tool, reply] = store.messages();
  assert.equal(user.content, 'hello there');
  assert.match(tool.content, /run_command git status/);
  assert.match(reply.content, /You said: "hello there"/);
  assert.match(reply.content, /cathy\/abc/);
});
