import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PREPARE } from './prepare.ts';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: gitEnv }).toString().trim();
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: tmpdir(), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

// A bare "GitHub" with one commit on main, and a workspace cloned from it.
function setup({ rejectPushes = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'prep-'));
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { env: gitEnv });
  execFileSync('git', ['init', '-q', '-b', 'main', seed], { env: gitEnv });
  writeFileSync(join(seed, 'README.md'), 'hi\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-qm', 'first');
  git(seed, 'push', '-q', remote, 'main');
  if (rejectPushes) {
    writeFileSync(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\necho "403: no push permission" >&2\nexit 1\n');
    chmodSync(join(remote, 'hooks', 'pre-receive'), 0o755);
  }
  const ws = join(root, 'workspace');
  execFileSync('git', ['clone', '-q', remote, ws], { env: gitEnv });
  return { remote, ws };
}

const run = (ws: string, branch: string, token = 'tok') =>
  execFileSync('bash', ['-c', PREPARE], { env: { ...gitEnv, WORKSPACE: ws, BRANCH: branch, GH_TOKEN: token } }).toString();

test('a new chat gets its own branch from main, pushed to GitHub', () => {
  const { remote, ws } = setup();
  run(ws, 'cathy/abc');
  assert.equal(git(ws, 'rev-parse', '--abbrev-ref', 'HEAD'), 'cathy/abc');
  assert.match(git(remote, 'branch', '--list', 'cathy/abc'), /cathy\/abc/);
});

test('if GitHub refuses the push, the box still works on the branch locally', () => {
  const { ws } = setup({ rejectPushes: true });
  const out = run(ws, 'cathy/abc'); // must not throw
  assert.equal(git(ws, 'rev-parse', '--abbrev-ref', 'HEAD'), 'cathy/abc');
  assert.match(out, /could not push/i);
});

test('already on the branch: nothing changes, uncommitted work is kept', () => {
  const { ws } = setup();
  run(ws, 'cathy/abc');
  writeFileSync(join(ws, 'work.txt'), 'in progress\n');
  run(ws, 'cathy/abc');
  assert.match(git(ws, 'status', '--porcelain'), /work\.txt/);
});
