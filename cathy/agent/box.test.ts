import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxTools, type Box, type RunResult } from './box.ts';

// An in-memory box: files in a Map, commands recorded instead of run.
function fakeBox(files: Record<string, string> = {}, runResult: Partial<RunResult> = {}) {
  const fs = new Map(Object.entries(files));
  const runs: { command: string; env?: Record<string, string> }[] = [];
  const box: Box = {
    async run(command, opts) {
      runs.push({ command, env: opts?.env });
      return { exitCode: 0, stdout: '', stderr: '', ...runResult };
    },
    async readFile(path) {
      if (!fs.has(path)) throw new Error(`ENOENT: ${path}`);
      return fs.get(path)!;
    },
    async writeFile(path, content) {
      fs.set(path, content);
    },
  };
  return { box, fs, runs };
}

const call = (tool: any, input: any) => tool.execute(input, {});

test('read_file numbers lines and respects offset/limit', async () => {
  const { box } = fakeBox({ 'a.txt': 'one\ntwo\nthree\nfour' });
  const out = await call(boxTools(box, 'cathy/x').read_file, { path: 'a.txt', offset: 2, limit: 2 });
  assert.match(out, /^\s+2  two\n\s+3  three\n… 1 more lines$/);
});

test('edit_file replaces a unique match', async () => {
  const { box, fs } = fakeBox({ 'a.txt': 'hello world' });
  const out = await call(boxTools(box, 'b').edit_file, { path: 'a.txt', old_string: 'world', new_string: 'Chris' });
  assert.equal(fs.get('a.txt'), 'hello Chris');
  assert.match(out, /Edited a\.txt/);
});

test('edit_file refuses ambiguous and missing matches without writing', async () => {
  const { box, fs } = fakeBox({ 'a.txt': 'x x' });
  const tools = boxTools(box, 'b');
  assert.match(await call(tools.edit_file, { path: 'a.txt', old_string: 'x', new_string: 'y' }), /matches 2 times/);
  assert.match(await call(tools.edit_file, { path: 'a.txt', old_string: 'z', new_string: 'y' }), /No match/);
  assert.equal(fs.get('a.txt'), 'x x');
});

test('edit_file replace_all replaces every match', async () => {
  const { box, fs } = fakeBox({ 'a.txt': 'x x x' });
  await call(boxTools(box, 'b').edit_file, { path: 'a.txt', old_string: 'x', new_string: 'y', replace_all: true });
  assert.equal(fs.get('a.txt'), 'y y y');
});

test('edit_file keeps $ signs in the replacement literally', async () => {
  const { box, fs } = fakeBox({ 'a.txt': 'price: X' });
  await call(boxTools(box, 'b').edit_file, { path: 'a.txt', old_string: 'X', new_string: '$5 $&' });
  assert.equal(fs.get('a.txt'), 'price: $5 $&');
});

test('grep passes the pattern through env, not the command string', async () => {
  const { box, runs } = fakeBox();
  await call(boxTools(box, 'b').grep, { pattern: '"; rm -rf / #' });
  assert.equal(runs[0].env?.PATTERN, '"; rm -rf / #');
  assert.ok(!runs[0].command.includes('rm -rf'));
});

test('open_pr pushes the session branch and returns the PR link', async () => {
  const { box, runs } = fakeBox({}, { stdout: 'https://github.com/x/y/pull/7\n' });
  const out = await call(boxTools(box, 'cathy/abc123').open_pr, { title: 'T', body: 'B' });
  assert.equal(out, 'PR: https://github.com/x/y/pull/7');
  assert.equal(runs[0].env?.BRANCH, 'cathy/abc123');
});

test('run_command shows exit code and stderr', async () => {
  const { box } = fakeBox({}, { exitCode: 2, stdout: 'out', stderr: 'bad' });
  const out = await call(boxTools(box, 'b').run_command, { command: 'false' });
  assert.equal(out, 'out\n[stderr]\nbad\n[exit 2]');
});

test('run_command takes a plain description for Chris, and asks for one', async () => {
  const { box, runs } = fakeBox();
  const tool = boxTools(box, 'b').run_command;
  const parsed = tool.inputSchema.safeParse({ command: 'npm test', description: 'Run the unit tests' });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.description, 'Run the unit tests');
  assert.match(tool.description, /description/i);
  await call(tool, { command: 'npm test', description: 'Run the unit tests' });
  assert.equal(runs[0].command, 'npm test', 'the description is not run');
});
