import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeCall, outcome, clip, MAX_OUTPUT } from './steps.ts';

test('a command is described by what Cathy said it does, and shows the command as input', () => {
  assert.deepEqual(describeCall('run_command', { command: 'npm test', description: 'Run the unit tests' }), { desc: 'Run the unit tests', input: 'npm test' });
});

test('a command without a description falls back to the command itself', () => {
  assert.deepEqual(describeCall('run_command', { command: 'git status --short' }), { desc: 'git status --short', input: 'git status --short' });
});

test('other tools get a plain description written for them', () => {
  const d = (tool: string, args: Record<string, unknown>) => describeCall(tool, args).desc;
  assert.equal(d('read_file', { path: 'README.md' }), 'Read README.md');
  assert.equal(d('write_file', { path: 'a/b.ts', content: 'x' }), 'Wrote a/b.ts');
  assert.equal(d('edit_file', { path: 'a.ts', old_string: 'x', new_string: 'y' }), 'Edited a.ts');
  assert.equal(d('grep', { pattern: 'TODO', path: 'cathy' }), 'Searched cathy for "TODO"');
  assert.equal(d('grep', { pattern: 'TODO' }), 'Searched the repo for "TODO"');
  assert.equal(d('list_files', { path: 'admin' }), 'Listed files in admin');
  assert.equal(d('list_files', {}), 'Listed files');
  assert.equal(d('open_pr', { title: 'Fix header', body: '…' }), 'Opened a PR: Fix header');
  assert.equal(d('publish_artifact', { path: '/tmp/x.md', title: 'Worksheet' }), 'Published "Worksheet"');
  assert.equal(d('set_title', { title: 'Blog fix' }), 'Named the chat "Blog fix"');
  assert.equal(d('message_cathy', { to: 'abc123', text: 'hi' }), 'Messaged Cathy abc123');
  assert.equal(d('list_cathys', {}), 'Listed the other Cathys');
  assert.equal(d('list_artifacts', {}), 'Listed this chat\'s artifacts');
  assert.equal(d('some_new_tool', { a: 1 }), 'some_new_tool');
});

test('a file write shows the path and size as input, never the whole file', () => {
  const { input } = describeCall('write_file', { path: 'big.txt', content: 'x'.repeat(50_000) });
  assert.equal(input, 'big.txt (50000 characters)');
});

test('an edit shows the text replaced and its replacement, trimmed', () => {
  const { input } = describeCall('edit_file', { path: 'a.ts', old_string: 'const a = 1;', new_string: 'const a = 2;' });
  assert.equal(input, 'a.ts\n− const a = 1;\n+ const a = 2;');
});

test('a command that exits non-zero, or a tool that refuses, is a failed step', () => {
  assert.equal(outcome('run_command', 'tests\n[stderr]\n1 failing\n[exit 1]').failed, true);
  assert.equal(outcome('run_command', 'all good\n[exit 0]').failed, false);
  assert.equal(outcome('edit_file', 'No match for old_string in a.ts. Read the file and copy the text exactly.').failed, true);
  assert.equal(outcome('edit_file', 'old_string matches 3 times in a.ts. Add more context, or set replace_all.').failed, true);
  assert.equal(outcome('message_cathy', 'Not sent (loop guard): 10 Cathy-to-Cathy messages in a row without Chris.').failed, true);
  assert.equal(outcome('edit_file', 'Edited a.ts (1 replacement)').failed, false);
});

test('a thrown tool error is a failed step with its message', () => {
  assert.deepEqual(outcome('read_file', undefined, new Error('ENOENT: nope.txt')), { output: 'Error: ENOENT: nope.txt', failed: true });
});

test('long output keeps its start and end, with the cut marked', () => {
  const long = 'A'.repeat(MAX_OUTPUT) + 'MIDDLE' + 'Z'.repeat(MAX_OUTPUT);
  const c = clip(long);
  assert.ok(c.length < MAX_OUTPUT + 100);
  assert.ok(c.startsWith('AAAA') && c.endsWith('ZZZZ'));
  assert.match(c, /… \d+ characters cut …/);
  assert.equal(clip('short'), 'short');
});

test('results that are objects are shown as readable JSON', () => {
  assert.equal(outcome('list_cathys', [{ id: 'a', title: 'x' }]).output, '[\n  {\n    "id": "a",\n    "title": "x"\n  }\n]');
});
