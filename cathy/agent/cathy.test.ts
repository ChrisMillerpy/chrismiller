import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createCathy } from './cathy.ts';
import { fakeModel } from './fake-model.ts';
import type { Box } from './box.ts';

const box: Box = {
  async run() {
    return { exitCode: 0, stdout: '', stderr: '' };
  },
  async readFile(path) {
    return path === 'README.md' ? '# withchris.uk' : '';
  },
  async writeFile() {},
};

test('Cathy has the box tools plus any extra tools', async () => {
  const extra = { tell_chris: createTool({ id: 'tell_chris', description: 'x', inputSchema: z.object({}), execute: async () => 'ok' }) };
  const cathy = createCathy({ model: fakeModel([]) as any, box, sessionId: 'abc123', branch: 'cathy/abc123', tools: extra });
  const tools = Object.keys(await cathy.listTools());
  for (const t of ['read_file', 'write_file', 'edit_file', 'list_files', 'grep', 'run_command', 'open_pr', 'tell_chris']) {
    assert.ok(tools.includes(t), `missing ${t}`);
  }
});

test('her instructions name her session and branch', async () => {
  const cathy = createCathy({ model: fakeModel([]) as any, box, sessionId: 'abc123', branch: 'cathy/abc123' });
  const text = JSON.stringify(await cathy.getInstructions());
  assert.match(text, /abc123/);
  assert.match(text, /cathy\/abc123/);
});

test('a turn can call a tool on the box and then answer', async () => {
  const model = fakeModel([{ tool: 'read_file', input: { path: 'README.md' } }, { text: 'It is the withchris.uk repo.' }]);
  const cathy = createCathy({ model: model as any, box, sessionId: 's', branch: 'cathy/s' });
  const out = await cathy.stream([{ role: 'user', content: 'What repo is this?' }], { maxSteps: 5 });
  const kinds: string[] = [];
  for await (const chunk of out.fullStream as any) kinds.push(chunk.type);
  assert.equal(await out.text, 'It is the withchris.uk repo.');
  assert.ok(kinds.includes('tool-call') && kinds.includes('tool-result'), kinds.join(','));
  // The tool result went back to the model on the second call.
  assert.match(JSON.stringify(model.calls[1]), /withchris\.uk/);
});

test('a sub-agent can be built without some tools and with extra instructions after her self', async () => {
  const cathy = createCathy({ model: fakeModel([]) as any, box, sessionId: 'c1', branch: 'cathy/c1', withoutTools: ['open_pr'], extraInstructions: async () => '## You are a sub-agent\nReport back.' });
  const tools = Object.keys(await cathy.listTools());
  assert.ok(!tools.includes('open_pr'));
  assert.ok(tools.includes('run_command'));
  const text = String(await cathy.getInstructions());
  assert.match(text, /## You are a sub-agent\nReport back\.$/);
});
