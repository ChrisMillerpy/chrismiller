import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Registry } from './registry.ts';

const read = (f: string) => readFileSync(new URL(`../../../d1/migrations/${f}`, import.meta.url), 'utf8');
const SCHEMA = [read('0001_sessions.sql'), read('0002_names_artifacts.sql')];

// Just enough of the D1 API, backed by an in-memory SQLite database.
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind: (...a: unknown[]) => ((args = a), stmt),
      all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
      first: async () => db.prepare(sql).get(...(args as any[])) ?? null,
      run: async () => (db.prepare(sql).run(...(args as any[])), { success: true }),
    };
    return stmt;
  };
  return { prepare, exec: async (sql: string) => db.exec(sql) } as any;
}

test('create makes an active session with a cathy/<id> branch', async () => {
  const reg = new Registry(fakeD1(), SCHEMA);
  const s = await reg.create('Fix the blog header', 1000);
  assert.match(s.id, /^[a-z0-9]{6}$/);
  assert.equal(s.branch, `cathy/${s.id}`);
  assert.deepEqual(await reg.get(s.id), { ...s });
});

test('list shows active sessions, most recently used first', async () => {
  const reg = new Registry(fakeD1(), SCHEMA);
  const a = await reg.create('a', 1000);
  const b = await reg.create('b', 2000);
  await reg.touch(a.id, 'latest message', 3000);
  const list = await reg.list();
  assert.deepEqual(list.map((s) => s.id), [a.id, b.id]);
  assert.equal(list[0].last_message, 'latest message');
});

test('archived sessions leave the list', async () => {
  const reg = new Registry(fakeD1(), SCHEMA);
  const a = await reg.create('a', 1000);
  await reg.archive(a.id);
  assert.deepEqual(await reg.list(), []);
});

test('touch trims long previews and sets a title on untitled chats', async () => {
  const reg = new Registry(fakeD1(), SCHEMA);
  const a = await reg.create('', 1000);
  await reg.touch(a.id, 'x'.repeat(500), 2000);
  const s = (await reg.get(a.id))!;
  assert.ok(s.last_message!.length <= 140);
  assert.ok(s.title.length > 0 && s.title.length <= 60);
});

test('the schema is applied once, even with many calls', async () => {
  const d1 = fakeD1();
  let execs = 0;
  const exec = d1.exec;
  d1.exec = async (sql: string) => (execs++, exec(sql));
  const reg = new Registry(d1, SCHEMA);
  await Promise.all([reg.list(), reg.list(), reg.create('x', 1)]);
  const once = execs;
  assert.ok(once > 0);
  await Promise.all([reg.list(), reg.create('y', 2)]);
  assert.equal(execs, once);
});

test('the schema can be applied to a database that already has it (redeploys)', async () => {
  const d1 = fakeD1();
  await new Registry(d1, SCHEMA).create('a', 1);
  const again = new Registry(d1, SCHEMA);
  assert.equal((await again.list()).length, 1);
});

test('Chris can rename any chat; Cathy only chats Chris has not named', async () => {
  const reg = new Registry(fakeD1(), SCHEMA);
  const a = await reg.create('', 1000);
  assert.equal(await reg.rename(a.id, 'Cathy name', 'cathy'), true);
  assert.equal(await reg.rename(a.id, 'Cathy again', 'cathy'), true);
  assert.equal(await reg.rename(a.id, 'Chris name', 'chris'), true);
  assert.equal(await reg.rename(a.id, 'Cathy late', 'cathy'), false);
  const s = (await reg.get(a.id))!;
  assert.equal(s.title, 'Chris name');
  assert.equal(s.named_by, 'chris');
  await reg.touch(a.id, 'new message', 2000);
  assert.equal((await reg.get(a.id))!.title, 'Chris name');
});

test('archived chats can be listed and brought back', async () => {
  const reg = new Registry(fakeD1(), SCHEMA);
  const a = await reg.create('a', 1000);
  await reg.archive(a.id);
  assert.deepEqual((await reg.list('archived')).map((s) => s.id), [a.id]);
  await reg.unarchive(a.id, 2000);
  assert.deepEqual((await reg.list()).map((s) => s.id), [a.id]);
});

test('blobs round-trip, including ones bigger than one part', async () => {
  const reg = new Registry(fakeD1(), SCHEMA);
  const big = new Uint8Array(2_500_000).map((_, i) => i % 251);
  await reg.putBlob('x', big);
  assert.deepEqual(await reg.getBlob('x'), big);
  await reg.putBlob('empty', new Uint8Array());
  assert.deepEqual(await reg.getBlob('empty'), new Uint8Array());
  assert.equal(await reg.getBlob('nope'), null);
});

test('uploads keep a safe name and their bytes', async () => {
  const reg = new Registry(fakeD1(), SCHEMA);
  const u = await reg.addUpload('s1', '../../etc/"pass"wd.png', 'image/png', new Uint8Array([1, 2, 3]));
  assert.equal(u.name, '_pass_wd.png');
  assert.deepEqual(await reg.upload(u.id), u);
  assert.deepEqual(await reg.getBlob(`upload:${u.id}`), new Uint8Array([1, 2, 3]));
});

test('artifacts start private and are only shared once Chris (or Cathy) opens them up', async () => {
  const reg = new Registry(fakeD1(), SCHEMA);
  const a = await reg.publish({ session_id: 's1', title: 'Worksheet', filename: 'ws.html', mime: 'text/html' }, new TextEncoder().encode('<h1>hi</h1>'), 1000);
  assert.equal(a.visibility, 'private');
  assert.match(a.token, /^[a-z0-9]{20}$/);
  assert.equal(await reg.shared(a.token), null, 'private artifacts are never shared');

  await reg.updateArtifact(a.id, { visibility: 'link' });
  assert.equal((await reg.shared(a.token))?.id, a.id);
  assert.deepEqual((await reg.artifacts({ visibility: 'public' })).map((x) => x.id), []);

  await reg.updateArtifact(a.id, { visibility: 'public' });
  assert.deepEqual((await reg.artifacts({ visibility: 'public' })).map((x) => x.id), [a.id]);

  const fresh = (await reg.newLink(a.id))!;
  assert.notEqual(fresh.token, a.token);
  assert.equal(await reg.shared(a.token), null, 'the old link stops working');
  assert.equal((await reg.shared(fresh.token))?.id, a.id);

  await assert.rejects(reg.updateArtifact(a.id, { visibility: 'everyone' as any }));
});

test('republishing an artifact keeps its id, link and visibility but swaps the content', async () => {
  const reg = new Registry(fakeD1(), SCHEMA);
  const a = await reg.publish({ session_id: 's1', title: 'v1', filename: 'a.html', mime: 'text/html', visibility: 'link' }, new TextEncoder().encode('one'), 1000);
  const b = await reg.publish({ session_id: 's1', title: 'v2', filename: 'a.html', mime: 'text/html', id: a.id }, new TextEncoder().encode('two!'), 2000);
  assert.equal(b.id, a.id);
  assert.equal(b.token, a.token);
  assert.equal(b.visibility, 'link');
  assert.equal(b.size, 4);
  assert.equal(new TextDecoder().decode((await reg.getBlob(`artifact:${a.id}`))!), 'two!');
  assert.equal((await reg.artifacts({ session_id: 's1' })).length, 1);
  await reg.deleteArtifact(a.id);
  assert.equal(await reg.artifact(a.id), null);
  assert.equal(await reg.getBlob(`artifact:${a.id}`), null);
});
