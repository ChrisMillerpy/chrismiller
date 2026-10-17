import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents, childInstructions, snapshot, MAX_WORKING, type ChildStub } from './agents.ts';
import { Registry } from './registry.ts';
import { fakeD1, SCHEMA } from './test-fakes.ts';
import type { Box } from '../../agent/box.ts';

const env = { MODEL: 'claude-opus-5-5', MODELS: 'claude-opus-5-5=Opus,claude-sonnet-5-5=Sonnet,claude-haiku-5-5=Haiku' };

async function setup(opts: { snapshotFails?: boolean } = {}) {
  const registry = new Registry(fakeD1(), SCHEMA);
  const parent = await registry.create('Parent');
  const calls: any[] = [];
  const snapshots: string[] = [];
  const child = (id: string): ChildStub => ({
    start: async (childId, parentId, history, task) => void calls.push({ kind: 'start', id, childId, parentId, history, task }),
    message: async (childId, parentId, text) => void calls.push({ kind: 'message', id, childId, parentId, text }),
    stop: async (childId) => void calls.push({ kind: 'stop', id, childId }),
  });
  const control = agents({
    id: parent.id,
    registry,
    env,
    child,
    forkHistory: () => [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'reply' }],
    snapshot: async (branch) => {
      if (opts.snapshotFails) throw new Error('push refused');
      snapshots.push(branch);
    },
  });
  return { registry, parent, control, calls, snapshots };
}

test('spawn makes a child chat on its own branch, snapshots the parent\'s work there, and hands it the task', async () => {
  const { registry, parent, control, calls, snapshots } = await setup();
  const a = await control.spawn({ task: 'Write tests for the blog', title: 'Blog tests' });
  const child = (await registry.get(a.id))!;
  assert.equal(child.parent_id, parent.id);
  assert.equal(child.mode, 'fresh', 'fresh is the default');
  assert.equal(child.title, 'Blog tests');
  assert.equal(child.state, 'working');
  assert.deepEqual(snapshots, [`cathy/${a.id}`], 'branch cut from the parent\'s current work before the child starts');
  assert.deepEqual(calls, [{ kind: 'start', id: a.id, childId: a.id, parentId: parent.id, history: [], task: 'Write tests for the blog' }]);
  assert.equal(a.url, `/cathy/${a.id}`);
  assert.equal(a.model, 'claude-opus-5-5', 'defaults filled in');
});

test('fork mode copies the parent\'s conversation; custom mode keeps the instructions', async () => {
  const { registry, control, calls } = await setup();
  const f = await control.spawn({ task: 'Do part B', mode: 'fork' });
  assert.deepEqual(calls[0].history, [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'reply' }]);
  const c = await control.spawn({ task: 'Review the diff', mode: 'custom', instructions: 'You are a strict reviewer. Do not edit files.' });
  assert.deepEqual(calls[1].history, []);
  assert.equal((await registry.get(c.id))!.instructions, 'You are a strict reviewer. Do not edit files.');
  assert.equal((await registry.get(f.id))!.instructions, null);
  await assert.rejects(control.spawn({ task: 'x', mode: 'custom' }), /instructions/);
});

test('each agent can have its own model and effort; unknown ones are refused', async () => {
  const { registry, control } = await setup();
  const a = await control.spawn({ task: 'Rename a variable', model: 'claude-haiku-5-5', effort: 'low' });
  const s = (await registry.get(a.id))!;
  assert.equal(s.model, 'claude-haiku-5-5');
  assert.equal(s.effort, 'low');
  assert.equal(a.model, 'claude-haiku-5-5');
  await assert.rejects(control.spawn({ task: 'x', model: 'gpt-9' }), /Unknown model/);
  await assert.rejects(control.spawn({ task: 'x', effort: 'extreme' }), /Effort/);
});

test(`at most ${MAX_WORKING} agents work at once, even when spawned together; idle ones free a slot`, async () => {
  const { registry, control } = await setup();
  const results = await Promise.allSettled(Array.from({ length: MAX_WORKING + 2 }, (_, i) => control.spawn({ task: `job ${i}` })));
  const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
  assert.equal(ok.length, MAX_WORKING);
  assert.match(String((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason), new RegExp(`${MAX_WORKING} sub-agents are already working`));
  await registry.setState(ok[0].value.id, 'idle');
  await control.spawn({ task: 'one more' });
});

test('sub-agents cannot start their own sub-agents', async () => {
  const { registry, parent, calls } = await setup();
  const child = await registry.createChild(parent.id, { title: 'c', task: 'c', mode: 'fresh' });
  const control = agents({ id: child.id, registry, env, child: () => ({ start: async () => void calls.push('x'), message: async () => {}, stop: async () => {} }), forkHistory: () => [] });
  await assert.rejects(control.spawn({ task: 'grandchild' }), /can't start their own/);
  assert.equal((await registry.list()).length, 2, 'nothing created');
});

test('if the snapshot fails, the child is archived and the error says why', async () => {
  const { registry, control, calls } = await setup({ snapshotFails: true });
  await assert.rejects(control.spawn({ task: 'x' }), /push refused/);
  assert.equal(calls.length, 0, 'the child never starts');
  assert.equal((await registry.list()).length, 1, 'only the parent is left active');
});

test('list, message and stop work on this chat\'s own agents only', async () => {
  const { registry, control, calls } = await setup();
  const a = await control.spawn({ task: 'a', title: 'A' });
  const stranger = await registry.create('Not mine');
  const list = await control.list();
  assert.deepEqual(list.map((x) => [x.id, x.title, x.state, x.mode, x.branch]), [[a.id, 'A', 'working', 'fresh', `cathy/${a.id}`]]);
  await control.message(a.id, 'Also update the README');
  await control.stop(a.id);
  assert.deepEqual(calls.slice(1).map((c) => [c.kind, c.childId, c.text]), [['message', a.id, 'Also update the README'], ['stop', a.id, undefined]]);
  await assert.rejects(control.message(stranger.id, 'hi'), /not one of your sub-agents/);
  await assert.rejects(control.stop('nope'), /not one of your sub-agents/);
});

test('stopAll stops every working child', async () => {
  const { registry, control, calls } = await setup();
  const a = await control.spawn({ task: 'a' });
  const b = await control.spawn({ task: 'b' });
  await registry.setState(b.id, 'idle');
  await control.stopAll();
  assert.deepEqual(calls.filter((c) => c.kind === 'stop').map((c) => c.childId), [a.id]);
});

test('a child\'s instructions say who started it, where to push, how to report, and include any custom role', () => {
  const text = childInstructions('p1', 'cathy/c1', 'You are a reviewer.');
  assert.match(text, /Cathy p1/);
  assert.match(text, /cathy\/c1/);
  assert.match(text, /final reply/i);
  assert.match(text, /You are a reviewer\./);
  assert.doesNotMatch(childInstructions('p1', 'cathy/c1', null), /Your role/);
});

// ── Snapshot: a real git repo and a real "remote" ──

function localBox(dir: string): Box {
  return {
    async run(command, opts) {
      try {
        const stdout = execSync(command, { cwd: dir, env: { ...process.env, ...opts?.env }, shell: '/bin/bash', stdio: ['ignore', 'pipe', 'pipe'] }).toString();
        return { exitCode: 0, stdout, stderr: '' };
      } catch (e: any) {
        return { exitCode: e.status ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
      }
    },
    readFile: async (p) => readFileSync(join(dir, p), 'utf8'),
    writeFile: async (p, c) => writeFileSync(join(dir, p), c),
  };
}

test('snapshot pushes committed and uncommitted work (not ignored files) to the child branch, leaving the parent untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'snap-'));
  const sh = (cmd: string, cwd = root) => execSync(cmd, { cwd, shell: '/bin/bash' }).toString().trim();
  const git = '-c user.email=t@t -c user.name=t';
  sh('git init -q --bare -b main remote.git');
  sh(`git clone -q remote.git work && cd work && printf 'node_modules\\n' > .gitignore && echo one > a.txt && git add -A && git ${git} commit -qm init && git push -q origin main && git checkout -qb cathy/parent`);
  const work = join(root, 'work');
  writeFileSync(join(work, 'a.txt'), 'two\n'); // modified, unstaged
  writeFileSync(join(work, 'new.txt'), 'new\n'); // untracked
  sh('mkdir -p node_modules && echo x > node_modules/junk', work); // ignored
  sh('echo staged > s.txt && git add s.txt', work); // staged
  const before = { head: sh('git rev-parse HEAD', work), status: sh('git status --porcelain', work) };

  await snapshot(localBox(work), 'parent', 'cathy/child', { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });

  assert.equal(sh('git show cathy/child:a.txt', join(root, 'remote.git')), 'two');
  assert.equal(sh('git show cathy/child:new.txt', join(root, 'remote.git')), 'new');
  assert.equal(sh('git show cathy/child:s.txt', join(root, 'remote.git')), 'staged');
  assert.throws(() => sh('git show cathy/child:node_modules/junk 2>/dev/null', join(root, 'remote.git')), 'ignored files stay out');
  assert.equal(sh('git rev-parse cathy/child~1', join(root, 'remote.git')), before.head, 'one snapshot commit on top of the parent\'s HEAD');
  assert.deepEqual({ head: sh('git rev-parse HEAD', work), status: sh('git status --porcelain', work) }, before, 'parent\'s HEAD, index and files unchanged');

  // Nothing uncommitted: the child branch is just the parent's HEAD.
  sh(`git add -A && git ${git} commit -qm wip`, work);
  await snapshot(localBox(work), 'parent', 'cathy/child2');
  assert.equal(sh('git rev-parse cathy/child2', join(root, 'remote.git')), sh('git rev-parse HEAD', work));

  await assert.rejects(snapshot(localBox(join(root, 'nope-not-a-dir-but-run-fails')), 'parent', 'cathy/x'), /Could not snapshot/);
});
